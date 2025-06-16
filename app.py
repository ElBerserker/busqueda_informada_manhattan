from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import logging
import uuid
import time
from osm_processor import OSMProcessor
from threading import Thread, Lock
import traceback
import os
import json
from pathlib import Path
import networkx as nx

DATA_DIR = Path("data")
CACHE_DIR = Path("cache")
GRAPH_FILE = DATA_DIR / "map_graph.json"
CACHE_FILE = CACHE_DIR / "route_cache.json"

# Crear directorios si no existen
DATA_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

# Cargar cache al inicio si existe
if CACHE_FILE.exists():
    with open(CACHE_FILE, 'r') as f:
        route_cache = json.load(f)
else:
    route_cache = {}
    
# Función para guardar el cache periodicamente
def save_cache():
    while True:
        time.sleep(60)  # Guardar cada 60 segundos
        with cache_lock:
            with open(CACHE_FILE, 'w') as f:
                json.dump(route_cache, f)
        logger.info("Cache guardado en disco")

# Iniciar hilo para guardar cache
cache_saver = Thread(target=save_cache, daemon=True)
cache_saver.start()    

# Configuración de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('api.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Inicializar procesador OSM
processor = OSMProcessor()

# Cache compartido con bloqueo para thread safety
route_cache = {}
cache_lock = Lock()

class PlaceRequest:
    def __init__(self, place_name: str, simplify: bool = True, network_type: str = "drive"):
        self.place_name = place_name
        self.simplify = simplify
        self.network_type = network_type

class SafetyPoint:
    def __init__(self, lat: float, lon: float, radius: float, safety_index: int, weight: float = 1.0):
        self.lat = lat
        self.lon = lon
        self.radius = radius
        self.safety_index = safety_index
        self.weight = weight

class RouteRequest:
    def __init__(self, start_lat: float, start_lon: float, end_lat: float, end_lon: float, 
                 safety_points: list[SafetyPoint] = [], optimization: str = "balanced",
                 heuristic: str = "euclidean", distance_weight: float = 0.4, 
                 time_weight: float = 0.3, safety_weight: float = 0.3):
        self.start_lat = start_lat
        self.start_lon = start_lon
        self.end_lat = end_lat
        self.end_lon = end_lon
        self.safety_points = safety_points
        self.optimization = optimization
        self.heuristic = heuristic
        self.distance_weight = distance_weight
        self.time_weight = time_weight
        self.safety_weight = safety_weight

def background_task(processor, request_dict, task_id, cache_key):
    try:
        logger.info(f"Iniciando cálculo de ruta para task_id: {task_id}")
        
        # Procesar la ruta - ahora pasamos solo el request_dict
        result = processor.calculate_route_task(request_dict)
        
        # Guardar en caché con bloqueo
        with cache_lock:
            route_cache[task_id] = result
            route_cache[cache_key] = result
            
        logger.info(f"Cálculo completado para task_id: {task_id}")
        
    except Exception as e:
        logger.error(f"Error en cálculo de ruta (task {task_id}): {str(e)}\n{traceback.format_exc()}")
        with cache_lock:
            route_cache[task_id] = {
                "error": str(e),
                "status": "failed"
            }


# Modificar el endpoint /load-map
@app.route('/load-map', methods=['POST'])
def load_map():
    try:
        data = request.get_json()
        req = PlaceRequest(
            place_name=data['place_name'],
            simplify=data.get('simplify', False),
            network_type=data.get('network_type', 'drive')
        )
        
        # Verificar si ya tenemos el grafo guardado
        cache_key = f"{req.place_name}_{req.network_type}_{req.simplify}"
        if GRAPH_FILE.exists():
            try:
                with open(GRAPH_FILE, 'r') as f:
                    graph_data = json.load(f)
                processor.graph = nx.node_link_graph(graph_data)
                logger.info(f"Grafo cargado desde archivo para: {req.place_name}")
                return jsonify({
                    "status": "success",
                    "nodes": len(processor.graph.nodes),
                    "edges": len(processor.graph.edges),
                    "message": f"Mapa de {req.place_name} cargado desde archivo"
                })
            except Exception as e:
                logger.warning(f"No se pudo cargar el grafo desde archivo: {str(e)}")
        
        # Si no existe, descargarlo
        logger.info(f"Descargando mapa para: {req.place_name}")
        result = processor.download_map(
            req.place_name, 
            req.simplify, 
            req.network_type
        )
        processor.save_graph(GRAPH_FILE)
        
        return jsonify({
            "status": "success",
            "nodes": result["nodes"],
            "edges": result["edges"],
            "message": f"Mapa de {req.place_name} descargado y guardado correctamente"
        })
        
    except Exception as e:
        logger.error(f"Error al cargar mapa: {str(e)}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 400

@app.route('/calculate-route', methods=['POST'])
def calculate_route():
    try:
        data = request.get_json()
        
        safety_points = [
            SafetyPoint(
                lat=sp['lat'],
                lon=sp['lon'],
                radius=sp['radius'],
                safety_index=sp['safety_index'],
                weight=sp.get('weight', 1.0)
            ) for sp in data.get('safety_points', [])
        ]
        
        # Ordenar los puntos seguros para asegurar consistencia en la cache_key
        safety_points_sorted = sorted(safety_points, key=lambda sp: (sp.lat, sp.lon, sp.radius, sp.safety_index))
        
        req = RouteRequest(
            start_lat=data['start_lat'],
            start_lon=data['start_lon'],
            end_lat=data['end_lat'],
            end_lon=data['end_lon'],
            safety_points=safety_points_sorted,  # Usar la versión ordenada
            optimization=data.get('optimization', 'balanced'),
            heuristic=data.get('heuristic', 'euclidean'),
            distance_weight=data.get('distance_weight', 0.4),
            time_weight=data.get('time_weight', 0.3),
            safety_weight=data.get('safety_weight', 0.3)
        )
        
        task_id = str(uuid.uuid4())
        
        # Generar cache_key consistente
        safety_points_key = "_".join(
            f"{sp.lat:.6f}_{sp.lon:.6f}_{sp.radius:.2f}_{sp.safety_index}_{sp.weight:.2f}"
            for sp in req.safety_points
        )
        
        cache_key = (
            f"{req.start_lat:.6f}_{req.start_lon:.6f}_"
            f"{req.end_lat:.6f}_{req.end_lon:.6f}_"
            f"{safety_points_key}_"
            f"{req.optimization}_{req.heuristic}_"
            f"{req.distance_weight:.2f}_{req.time_weight:.2f}_{req.safety_weight:.2f}"
        )
        
        # Verificar caché
        with cache_lock:
            if cache_key in route_cache:
                logger.info(f"Resultado obtenido de caché para clave: {cache_key}")
                return jsonify({
                    "status": "completed",
                    "task_id": cache_key,
                    "message": "Resultado obtenido de caché"
                })
        
        request_dict = {
            'start_lat': req.start_lat,
            'start_lon': req.start_lon,
            'end_lat': req.end_lat,
            'end_lon': req.end_lon,
            'safety_points': [{
                'lat': sp.lat,
                'lon': sp.lon,
                'radius': sp.radius,
                'safety_index': sp.safety_index,
                'weight': sp.weight
            } for sp in req.safety_points],
            'optimization': req.optimization,
            'heuristic': req.heuristic,
            'distance_weight': req.distance_weight,
            'time_weight': req.time_weight,
            'safety_weight': req.safety_weight
        }
        
        # Iniciar hilo con el cálculo
        thread = Thread(
            target=background_task,
            args=(processor, request_dict, task_id, cache_key)
        )
        thread.start()
        
        return jsonify({
            "status": "processing",
            "task_id": task_id,
            "message": "El cálculo de la ruta está en progreso"
        })
        
    except Exception as e:
        logger.error(f"Error al iniciar cálculo de ruta: {str(e)}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 400
    

@app.route('/route-result/<task_id>', methods=['GET'])
def get_route_result(task_id: str):
    with cache_lock:
        if task_id in route_cache:
            result = route_cache[task_id]
            if "error" in result:
                return jsonify({"error": result["error"]}), 400
            return jsonify(result)
    
    return jsonify({
        "error": "Resultado no encontrado. La tarea puede estar todavía en procesamiento o haber expirado."
    }), 404

@app.route('/')
def root():
    return render_template('index.html')

# Añadir al final del archivo
@app.teardown_appcontext
def shutdown_handler(exception=None):
    """Guardar cache al cerrar la aplicación"""
    with cache_lock:
        with open(CACHE_FILE, 'w') as f:
            json.dump(route_cache, f)
    logger.info("Aplicación cerrada - Cache guardado")

if __name__ == '__main__':
    app.run(debug=True, threaded=True)