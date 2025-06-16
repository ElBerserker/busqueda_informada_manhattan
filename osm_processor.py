import osmnx as ox
import networkx as nx
import math
import numpy as np
import json
import logging
from typing import List, Tuple, Dict, Union, Optional
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import time

logger = logging.getLogger(__name__)

class OSMProcessor:
    def __init__(self):
        self.graph = None
        self.safety_zones = []
        self.default_speed = 50  # km/h
        self.graph_cache = {}  # Cache para grafos procesados
        self.heuristic_cache = {}  # Cache para cálculos de heurística
        self.edge_processing_cache = {}  # Cache para procesamiento de aristas
        
    def load_graph(self, filename: str):
        """Carga un grafo desde un archivo JSON"""
        try:
            with open(filename, 'r') as f:
                graph_data = json.load(f)
            
            self.graph = nx.node_link_graph(graph_data)
            logger.info(f"Grafo cargado desde: {filename}")
            return {"status": "success", "nodes": len(self.graph.nodes), "edges": len(self.graph.edges)}
            
        except Exception as e:
            logger.error(f"Error al cargar grafo: {str(e)}", exc_info=True)
            raise Exception(str(e))
        
    def download_map(self, place_name: str, simplify: bool = True, network_type: str = "drive") -> Dict:
        """
        Descarga un grafo de OpenStreetMap y lo prepara para análisis.
        """
        cache_key = f"{place_name}_{network_type}_{simplify}"
        if cache_key in self.graph_cache:
            logger.info(f"Usando grafo en caché para {cache_key}")
            self.graph = self.graph_cache[cache_key]
            return {"nodes": len(self.graph.nodes), "edges": len(self.graph.edges)}
        
        try:
            logger.info(f"Descargando mapa para: {place_name} (tipo: {network_type})")
            
            # Descargar grafo
            self.graph = ox.graph_from_place(
                place_name, 
                network_type=network_type,
                simplify=False
            )
            
            # Procesar velocidades en paralelo
            self._process_speeds_parallel()
            
            # Simplificar si se requiere
            if simplify:
                self.graph = ox.simplify_graph(self.graph)
                logger.info("Grafo simplificado")
            
            # Guardar en caché
            self.graph_cache[cache_key] = self.graph
            
            return {"nodes": len(self.graph.nodes), "edges": len(self.graph.edges)}
            
        except Exception as e:
            logger.error(f"Error al descargar mapa: {str(e)}", exc_info=True)
            raise Exception(str(e))
    
    def _process_speeds_parallel(self):
        """Procesa las velocidades de las aristas en paralelo"""
        with ThreadPoolExecutor() as executor:
            futures = []
            for u, v, k, data in self.graph.edges(data=True, keys=True):
                futures.append(executor.submit(self._process_single_edge_speed, u, v, k, data))
            
            # Esperar a que todos terminen
            for future in futures:
                future.result()
    
    def _process_single_edge_speed(self, u, v, k, data):
        """Procesa la velocidad de una sola arista"""
        cache_key = f"{u}_{v}_{k}"
        if cache_key in self.edge_processing_cache:
            data.update(self.edge_processing_cache[cache_key])
            return
        
        processed_data = {}
        
        # Asignar velocidad por defecto si no existe
        if 'maxspeed' not in data:
            processed_data['maxspeed'] = self.default_speed
        else:
            # Manejar casos donde maxspeed es una lista
            if isinstance(data['maxspeed'], list):
                try:
                    speeds = [self._parse_speed(s) for s in data['maxspeed']]
                    processed_data['maxspeed'] = min(speeds) if speeds else self.default_speed
                except (ValueError, TypeError):
                    processed_data['maxspeed'] = self.default_speed
            # Convertir velocidades de string a float
            elif isinstance(data['maxspeed'], str):
                processed_data['maxspeed'] = self._parse_speed(data['maxspeed'])
            # Asegurar que es numérico
            elif not isinstance(data['maxspeed'], (int, float)):
                processed_data['maxspeed'] = self.default_speed
            
            # Limitar velocidad mínima
            if processed_data['maxspeed'] < 5:
                processed_data['maxspeed'] = 5
        
        # Guardar en caché
        self.edge_processing_cache[cache_key] = processed_data
        data.update(processed_data)
                
    def _parse_speed(self, speed_str: str) -> float:
        """Parsea un string de velocidad a float"""
        try:
            speed_str = speed_str.lower().split(';')[0].split('@')[0].strip()
            
            if 'mph' in speed_str:
                speed_value = float(speed_str.replace('mph', '').strip()) * 1.60934
            else:
                speed_value = float(speed_str.replace('km/h', '').split()[0])
            return max(5, speed_value)
        except (ValueError, AttributeError):
            return self.default_speed                
    
    def save_graph(self, filename: str):
        """Guarda el grafo en un archivo JSON con formato compatible"""
        try:
            # Convertir el grafo a un formato serializable
            graph_data = nx.node_link_data(self.graph)
            
            # Función para manejar geometrías
            def default_serializer(obj):
                if hasattr(obj, '__geo_interface__'):
                    return obj.__geo_interface__
                raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
            
            # Guardar el archivo
            with open(filename, 'w') as f:
                json.dump(graph_data, f, default=default_serializer, indent=2)
                
            logger.info(f"Grafo guardado en: {filename}")
            return {"status": "success", "filename": filename}
            
        except Exception as e:
            logger.error(f"Error al guardar grafo: {str(e)}", exc_info=True)
            raise Exception(str(e))
    
    def add_safety_zones(self, safety_points: list[tuple[float, float, float, int, float]]):
        """Agrega zonas de seguridad al grafo"""
        self.safety_zones = []
        for lat, lon, radius, safety_idx, weight in safety_points:
            try:
                center_node = ox.distance.nearest_nodes(self.graph, lon, lat)
                self.safety_zones.append({
                    'center': center_node,
                    'radius': radius,
                    'safety_index': safety_idx,
                    'weight': weight
                })
            except Exception as e:
                logger.warning(f"No se pudo agregar punto de seguridad: {str(e)}")
                continue
    
    def euclidean_distance(self, node1: int, node2: int) -> float:
        """Distancia euclidiana entre dos nodos en metros"""
        cache_key = f"euclidean_{node1}_{node2}"
        if cache_key in self.heuristic_cache:
            return self.heuristic_cache[cache_key]
        
        lat1, lon1 = self.graph.nodes[node1]['y'], self.graph.nodes[node1]['x']
        lat2, lon2 = self.graph.nodes[node2]['y'], self.graph.nodes[node2]['x']
        
        dx = (lon2 - lon1) * 111320 * math.cos(math.radians(lat1))
        dy = (lat2 - lat1) * 111000
        distance = math.sqrt(dx**2 + dy**2)
        
        self.heuristic_cache[cache_key] = distance
        return distance
    
    def manhattan_distance(self, node1: int, node2: int) -> float:
        """Distancia Manhattan entre dos nodos en metros"""
        cache_key = f"manhattan_{node1}_{node2}"
        if cache_key in self.heuristic_cache:
            return self.heuristic_cache[cache_key]
        
        lat1, lon1 = self.graph.nodes[node1]['y'], self.graph.nodes[node1]['x']
        lat2, lon2 = self.graph.nodes[node2]['y'], self.graph.nodes[node2]['x']
        
        dx = (lon2 - lon1) * 111320 * math.cos(math.radians(lat1))
        dy = (lat2 - lat1) * 111000
        distance = abs(dx) + abs(dy)
        
        self.heuristic_cache[cache_key] = distance
        return distance
    
    @lru_cache(maxsize=10000)
    def _calculate_safety_influence(self, u: int, v: int) -> float:
        """Calcula la influencia de seguridad entre dos nodos (con memoización)"""
        if not self.safety_zones:
            return 0.0
            
        lat1, lon1 = self.graph.nodes[u]['y'], self.graph.nodes[u]['x']
        lat2, lon2 = self.graph.nodes[v]['y'], self.graph.nodes[v]['x']
        mid_lat = (lat1 + lat2) / 2
        mid_lon = (lon1 + lon2) / 2
        mid_node = ox.distance.nearest_nodes(self.graph, mid_lon, mid_lat)
        
        safety_influence = 0.0
        for zone in self.safety_zones:
            distance = self.euclidean_distance(mid_node, zone['center'])
            if distance <= zone['radius']:
                influence = (1 - (distance / zone['radius'])) * zone['safety_index'] * zone['weight']
                safety_influence += influence
        
        return min(safety_influence, 10.0)
    
    def calculate_edge_weight(self, u: int, v: int, optimization: str,
                            distance_weight: float, time_weight: float, 
                            safety_weight: float) -> float:
        """Calcula el peso compuesto de una arista según la estrategia de optimización"""
        edge_data = self.graph.edges[u, v, 0]
        length = edge_data.get('length', 1)
        
        try:
            speed = float(edge_data.get('maxspeed', self.default_speed))
        except (TypeError, ValueError):
            speed = self.default_speed
        
        distance = length
        time = length / max(0.1, speed) * 3.6
        safety = self._calculate_safety_influence(u, v)
        
        if optimization == "shortest":
            return distance
        elif optimization == "fastest":
            return time * 1000
        elif optimization == "safest":
            return safety * 200
        else:  # balanced
            total_weight = distance_weight + time_weight + safety_weight
            if total_weight <= 0:
                total_weight = 1.0
            
            dist_component = (distance / 1000) * (distance_weight / total_weight)
            time_component = (time * 3600) * (time_weight / total_weight)
            safety_component = safety * (safety_weight / total_weight)
            
            return dist_component + time_component + safety_component
    
    def calculate_route_task(self, request: dict) -> dict:
        """Calcula la ruta y devuelve el resultado directamente"""
        try:
            start_time = time.time()
            
            # Verificar que el grafo esté cargado
            if self.graph is None:
                raise Exception("El grafo no ha sido cargado. Primero llama a download_map()")
            
            # Convertir puntos de seguridad a tuplas
            safety_tuples = [
                (sp['lat'], sp['lon'], sp['radius'], sp['safety_index'], sp.get('weight', 1.0)) 
                for sp in request['safety_points']
            ]
            
            # Añadir zonas de seguridad
            self.add_safety_zones(safety_tuples)
            
            # Obtener coordenadas
            start_lon = request['start_lon']
            start_lat = request['start_lat']
            end_lon = request['end_lon']
            end_lat = request['end_lat']
            
            # Encontrar nodos más cercanos
            start_node = ox.distance.nearest_nodes(self.graph, start_lon, start_lat)
            end_node = ox.distance.nearest_nodes(self.graph, end_lon, end_lat)
            
            logger.info(f"Calculando ruta desde {start_lat},{start_lon} hasta {end_lat},{end_lon}")
            
            # Configurar heurística
            if request['heuristic'] == "manhattan":
                heuristic_func = lambda n, _: self.manhattan_distance(n, end_node)
            else:
                heuristic_func = lambda n, _: self.euclidean_distance(n, end_node)
            
            # Configurar función de peso
            weight_func = lambda u, v, d: self.calculate_edge_weight(
                u, v, 
                request['optimization'], 
                request['distance_weight'], 
                request['time_weight'], 
                request['safety_weight']
            )
            
            # Calcular ruta con A*
            logger.info("Iniciando cálculo de ruta con algoritmo A*")
            path = nx.astar_path(
                self.graph,
                start_node,
                end_node,
                heuristic=heuristic_func,
                weight=weight_func
            )
            logger.info(f"Ruta calculada con {len(path)} segmentos")
            
            # Calcular métricas detalladas
            total_distance = 0.0
            total_time_sec = 0.0
            total_safety = 0.0
            segments = []
            
            for i in range(len(path)-1):
                u = path[i]
                v = path[i+1]
                edge_data = self.graph.edges[u, v, 0]
                
                length = edge_data.get('length', 0)
                speed = edge_data.get('maxspeed', self.default_speed)
                segment_time = length / max(0.1, speed) * 3.6
                safety = self._calculate_safety_influence(u, v)
                
                total_distance += length
                total_time_sec += segment_time
                total_safety += safety
                
                segments.append({
                    'start': (self.graph.nodes[u]['y'], self.graph.nodes[u]['x']),
                    'end': (self.graph.nodes[v]['y'], self.graph.nodes[v]['x']),
                    'distance': length,
                    'time': segment_time,
                    'speed': speed,
                    'safety': safety,
                    'safety_level': self._get_safety_level(safety)
                })
            
            avg_speed = total_distance / total_time_sec * 3.6 if total_time_sec > 0 else 0
            avg_safety = total_safety / len(segments) if segments else 0
            
            # Preparar respuesta
            path_coords = [(self.graph.nodes[node]['y'], self.graph.nodes[node]['x']) 
                        for node in path]
            
            result = {
                'path': path_coords,
                'segments': segments,
                'summary': {
                    'total_distance': total_distance,
                    'total_distance_km': total_distance / 1000,
                    'total_time': total_time_sec,
                    'total_time_minutes': total_time_sec / 60,
                    'total_safety': total_safety,
                    'avg_speed': avg_speed,
                    'avg_safety': avg_safety,
                    'safety_level': self._get_safety_level(avg_safety),
                    'optimization': request['optimization'],
                    'processing_time': time.time() - start_time
                },
                'metadata': {
                    'optimization': request['optimization'],
                    'heuristic': request['heuristic'],
                    'weights': {
                        'distance': request['distance_weight'],
                        'time': request['time_weight'],
                        'safety': request['safety_weight']
                    },
                    'safety_points_count': len(request['safety_points'])
                },
                'status': 'completed'
            }
            
            logger.info(f"Cálculo de ruta completado en {result['summary']['processing_time']:.2f} segundos")
            return result
            
        except Exception as e:
            logger.error(f"Error en cálculo de ruta: {str(e)}\n{traceback.format_exc()}")
            return {
                "error": str(e),
                "status": "failed",
                "traceback": traceback.format_exc()
            }
    
    def _get_safety_level(self, safety_score: float) -> str:
        """Convierte un puntaje de seguridad a nivel descriptivo"""
        if safety_score < 1:
            return "Muy seguro"
        elif safety_score < 2:
            return "Seguro"
        elif safety_score < 3:
            return "Moderado"
        elif safety_score < 4:
            return "Inseguro"
        else:
            return "Muy inseguro"