#Define el lugar y carga el mapa de carreteras.
curl -X POST "http://localhost:8000/load-map" \
-H "Content-Type: application/json" \
-d '{"place_name": "Jilotepec, México"}' 

#Una vez que se ha cargado el mapa de carreteras podemos :
# 1.- Definir el punto de origen y destino
# 2.- Establecer el tipo de optimización:
#   "shortest: para la ruta mas corta"
#   "fastest: para la ruta mas rapida" 
#   "safest: para la ruta mas segura" 
#   "balanced: para una ruta que contemple todos los puntos anteriores"
# 3.- Seleccionar el tipo de heuristica
#   "euclidean: para carreteras irregulares"
#   "manhattan: para carreteras de tipo rejilla"
# 4.- Finalmente podemos definir puntos seguros, estos tienen un punto 
#     de origen, un radio y un nivel de seguridad del 1 al 5, donde 1 es 
#     muy seguro y 5 es muy inseguro.      
curl -X POST "http://localhost:8000/calculate-route" \
-H "Content-Type: application/json" \
-d '{
	 "start_lat" : 19.948206,
	 "start_lon" : -99.539248,
	 "end_lat" : 19.959837,
	 "end_lon" : -99.526234, 
	 "optimization": "safest",
	 "heuristic": "euclidean",
	 "safety_points": [
	   {
	      "lat": 19.956125,
	      "lon":  -99.533535,
	      "radius": 500,
	      "safety_index": 4
	    },
	    {
	      "lat": 19.951768,
	      "lon": -99.537466,
	      "radius": 300,
	      "safety_index": 2
	    }
	  ]
}'


