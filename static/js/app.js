document.addEventListener('DOMContentLoaded', function () {
    // Variables globales
    let map;
    let routeLayer;
    let startMarker, endMarker;
    let safetyMarkers = [];
    let currentTaskId = null;
    let checkResultInterval = null;
    let selectionMode = null; // 'start', 'end' o 'safety'
    let currentSafetyPointId = null;

    // Elementos del DOM
    const sections = document.querySelectorAll('.section-header');
    const loadMapBtn = document.getElementById('load-map-btn');
    const calculateRouteBtn = document.getElementById('calculate-route-btn');
    const newCalculationBtn = document.getElementById('new-calculation-btn');
    const addSafetyPointBtn = document.getElementById('add-safety-point');
    const selectSafetyPointBtn = document.getElementById('select-safety-point');
    const safetyPointsContainer = document.getElementById('safety-points-container');
    const resultsContent = document.getElementById('results-content');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessage = document.getElementById('error-message');
    const setStartBtn = document.getElementById('set-start-btn');
    const setEndBtn = document.getElementById('set-end-btn');
    const selectingModeIndicator = document.createElement('div');
    selectingModeIndicator.className = 'selecting-mode';
    document.body.appendChild(selectingModeIndicator);
    document.getElementById('optimization').addEventListener('change', updateWeightsVisibility);

    sections.forEach(section => {
        const contentId = section.getAttribute('data-section') + '-content';
        const content = document.getElementById(contentId);

        // Inicializar todas las secciones como desplegadas
        section.classList.add('collapsed');
        content.classList.add('collapsed');

        section.addEventListener('click', () => {
            section.classList.toggle('collapsed');
            content.classList.toggle('collapsed');

            // Ajustar el mapa cuando se expande/contrae una sección
            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 300);
        });
    });

    document.querySelector('[data-section="route-settings"]').classList.remove('collapsed');
    document.getElementById('route-settings-content').classList.remove('collapsed');

    updateWeightsVisibility();

    // Inicializar el mapa
    initMap();

    // Event Listeners
    loadMapBtn.addEventListener('click', loadMap);
    calculateRouteBtn.addEventListener('click', calculateRoute);
    newCalculationBtn.addEventListener('click', resetCalculation);
    addSafetyPointBtn.addEventListener('click', addSafetyPoint);
    selectSafetyPointBtn.addEventListener('click', () => {
        if (document.querySelectorAll('.safety-point').length === 0) {
            showError('Primero añade un punto de seguridad');
            return;
        }
        setSelectionMode('safety');
    });
    setStartBtn.addEventListener('click', () => setSelectionMode('start'));
    setEndBtn.addEventListener('click', () => setSelectionMode('end'));

    // Sliders de pesos
    document.getElementById('distance-weight').addEventListener('input', updateWeightValue);
    document.getElementById('time-weight').addEventListener('input', updateWeightValue);
    document.getElementById('safety-weight').addEventListener('input', updateWeightValue);

    // Inicializar valores de los sliders
    updateWeightValue();

    function setSelectionMode(mode, safetyPointId = null) {
        selectionMode = mode;

        if (mode === 'safety' && safetyPointId) {
            const pointEl = document.querySelector(`.safety-point button[data-id="${safetyPointId}"]`)?.parentNode;
            if (pointEl) {
                const safetyIndex = parseInt(pointEl.querySelector('.safety-index').value) || 1;
                currentSafetyPointId = { id: safetyPointId, safetyIndex };
            }
        } else {
            currentSafetyPointId = null;
        }

        if (mode) {
            let message = '';
            if (mode === 'start') message = 'Seleccionando punto de inicio';
            else if (mode === 'end') message = 'Seleccionando punto de fin';
            else if (mode === 'safety') message = 'Seleccionando ubicación de punto de seguridad';

            selectingModeIndicator.textContent = message;
            selectingModeIndicator.style.display = 'block';
        } else {
            selectingModeIndicator.style.display = 'none';
        }
    }

    function resetCalculation() {
        // Limpiar resultados
        resultsContent.classList.add('hidden');

        // Limpiar mapa
        if (routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }

        // Limpiar marcadores de inicio/fin
        if (startMarker) {
            map.removeLayer(startMarker);
            startMarker = null;
        }
        if (endMarker) {
            map.removeLayer(endMarker);
            endMarker = null;
        }

        // Limpiar inputs de inicio/fin
        document.getElementById('start-lat').value = '';
        document.getElementById('start-lon').value = '';
        document.getElementById('end-lat').value = '';
        document.getElementById('end-lon').value = '';

        // Limpiar marcadores de seguridad
        safetyMarkers.forEach(marker => {
            map.removeLayer(marker.marker);
            map.removeLayer(marker.circle);
        });
        safetyMarkers = [];

        // Limpiar TODOS los puntos de seguridad en el formulario
        safetyPointsContainer.innerHTML = '';

        // Limpiar intervalo de verificación
        if (checkResultInterval) {
            clearInterval(checkResultInterval);
            checkResultInterval = null;
        }

        // Añadir un punto de seguridad vacío por defecto
        addSafetyPoint();
    }

    // Función para inicializar el mapa
    function initMap() {
        map = L.map('map').setView([19.954, -99.533], 14);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Evento para hacer clic en el mapa
        map.on('click', function (e) {
            if (selectionMode) {
                const lat = e.latlng.lat.toFixed(6);
                const lng = e.latlng.lng.toFixed(6);

                if (selectionMode === 'start') {
                    document.getElementById('start-lat').value = lat;
                    document.getElementById('start-lon').value = lng;
                    updateStartMarker(e.latlng);
                } else if (selectionMode === 'end') {
                    document.getElementById('end-lat').value = lat;
                    document.getElementById('end-lon').value = lng;
                    updateEndMarker(e.latlng);
                } else if (selectionMode === 'safety' && currentSafetyPointId) {
                    const pointEl = document.querySelector(`.safety-point button[data-id="${currentSafetyPointId.id}"]`)?.parentNode;
                    if (pointEl) {
                        const radius = parseFloat(pointEl.querySelector('.safety-radius').value) || 200;
                        pointEl.querySelector('.safety-lat').value = lat;
                        pointEl.querySelector('.safety-lon').value = lng;
                        updateSafetyMarker(
                            currentSafetyPointId.id,
                            e.latlng,
                            radius,
                            currentSafetyPointId.safetyIndex
                        );
                    }
                }

                setSelectionMode(null);
            }
        });
    }

    function updateSafetyMarker(id, latlng, radius = 200, safetyIndex = 1) {
        // Eliminar marcadores existentes para este punto
        const existingIndex = safetyMarkers.findIndex(m => m.id == id);
        if (existingIndex !== -1) {
            map.removeLayer(safetyMarkers[existingIndex].marker);
            map.removeLayer(safetyMarkers[existingIndex].circle);
            safetyMarkers.splice(existingIndex, 1);
        }

        // Determinar color según nivel de seguridad
        const colors = {
            1: { color: '#2ecc71', fillColor: '#d5f5e3' }, // Muy seguro
            2: { color: '#27ae60', fillColor: '#a3e4d7' }, // Seguro
            3: { color: '#f39c12', fillColor: '#fdebd0' }, // Moderado
            4: { color: '#e74c3c', fillColor: '#fadbd8' }, // Inseguro
            5: { color: '#c0392b', fillColor: '#f5b7b1' }  // Muy inseguro
        };

        const { color, fillColor } = colors[safetyIndex] || colors[4];

        // Añadir nuevos marcadores
        const marker = L.marker(latlng, {
            icon: L.divIcon({
                className: `safety-marker level-${safetyIndex}`,
                html: `<i class="fas fa-shield-alt" style="color: ${color}; font-size: 18px;"></i>`,
                iconSize: [18, 18]
            })
        }).addTo(map);

        const circle = L.circle(latlng, {
            radius: radius,
            color: color,
            fillColor: fillColor,
            fillOpacity: 0.2,
            className: `safety-circle level-${safetyIndex}`
        }).addTo(map);

        safetyMarkers.push({ id, marker, circle, radius, safetyIndex });
    }

    // Función para actualizar los marcadores
    function updateStartMarker(latlng) {
        if (startMarker) {
            startMarker.setLatLng(latlng);
        } else {
            startMarker = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'start-marker',
                    html: '<i class="fas fa-play" style="color: #2ecc71; font-size: 24px;"></i>',
                    iconSize: [24, 24]
                })
            }).addTo(map);
        }
    }

    function updateEndMarker(latlng) {
        if (endMarker) {
            endMarker.setLatLng(latlng);
        } else {
            endMarker = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'end-marker',
                    html: '<i class="fas fa-stop" style="color: #e74c3c; font-size: 24px;"></i>',
                    iconSize: [24, 24]
                })
            }).addTo(map);
        }
    }

    // Función para cargar el mapa
    function loadMap() {
        const placeName = document.getElementById('place-name').value;

        if (!placeName) {
            showError('Por favor ingresa un nombre de lugar');
            return;
        }

        fetch('/load-map', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                place_name: placeName
            })
        })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    document.getElementById('node-count').textContent = data.nodes;
                    document.getElementById('edge-count').textContent = data.edges;
                    document.getElementById('map-stats').classList.remove('hidden');

                    // Centrar el mapa en el área cargada
                    geocodePlace(placeName);
                } else {
                    showError(data.error || 'Error al cargar el mapa');
                }
            })
            .catch(error => {
                showError('Error al conectar con el servidor');
                console.error('Error:', error);
            });
    }

    // Función para geocodificar un lugar y centrar el mapa
    function geocodePlace(placeName) {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}`)
            .then(response => response.json())
            .then(data => {
                if (data && data.length > 0) {
                    const lat = parseFloat(data[0].lat);
                    const lon = parseFloat(data[0].lon);
                    map.setView([lat, lon], 14);
                }
            })
            .catch(error => {
                console.error('Error en geocodificación:', error);
            });
    }

    // Función para calcular la ruta
    function calculateRoute() {
        // Validar campos
        const startLat = parseFloat(document.getElementById('start-lat').value);
        const startLon = parseFloat(document.getElementById('start-lon').value);
        const endLat = parseFloat(document.getElementById('end-lat').value);
        const endLon = parseFloat(document.getElementById('end-lon').value);

        if (isNaN(startLat) || isNaN(startLon) || isNaN(endLat) || isNaN(endLon)) {
            showError('Por favor selecciona puntos de inicio y fin en el mapa');
            return;
        }

        // Obtener puntos de seguridad
        const safetyPoints = [];
        const safetyElements = document.querySelectorAll('.safety-point');

        safetyElements.forEach(el => {
            const lat = parseFloat(el.querySelector('.safety-lat').value);
            const lon = parseFloat(el.querySelector('.safety-lon').value);
            const radius = parseFloat(el.querySelector('.safety-radius').value);
            const safetyIndex = parseInt(el.querySelector('.safety-index').value);
            const weight = parseFloat(el.querySelector('.safety-weight').value) || 1.0;

            if (!isNaN(lat) && !isNaN(lon)) {
                safetyPoints.push({
                    lat,
                    lon,
                    radius: isNaN(radius) ? 200 : radius,
                    safety_index: isNaN(safetyIndex) ? 1 : safetyIndex,
                    weight: isNaN(weight) ? 1.0 : weight
                });
            }
        });

        // Configuración de la ruta
        const requestData = {
            start_lat: startLat,
            start_lon: startLon,
            end_lat: endLat,
            end_lon: endLon,
            optimization: document.getElementById('optimization').value,
            heuristic: document.getElementById('heuristic').value,
            distance_weight: parseFloat(document.getElementById('distance-weight').value) / 100,
            time_weight: parseFloat(document.getElementById('time-weight').value) / 100,
            safety_weight: parseFloat(document.getElementById('safety-weight').value) / 100,
            safety_points: safetyPoints
        };

        // Mostrar indicador de carga
        resultsContent.classList.add('hidden');
        errorMessage.classList.add('hidden');
        loadingIndicator.classList.remove('hidden');

        // Limpiar ruta anterior
        if (routeLayer) {
            map.removeLayer(routeLayer);
        }

        // Limpiar intervalo anterior si existe
        if (checkResultInterval) {
            clearInterval(checkResultInterval);
        }
        console.log("Enviando puntos de seguridad:", safetyPoints);
        // Enviar solicitud
        fetch('/calculate-route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Error en la respuesta del servidor');
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'processing') {
                    currentTaskId = data.task_id;
                    // Verificar cada segundo
                    checkResultInterval = setInterval(() => checkRouteResult(currentTaskId), 1000);
                } else if (data.status === 'completed') {
                    // Respuesta directa desde caché
                    currentTaskId = data.task_id;
                    displayRouteResult(data);
                } else {
                    showError(data.error || 'Error desconocido al calcular la ruta');
                }
            })
            .catch(error => {
                showError('Error al conectar con el servidor: ' + error.message);
                console.error('Error:', error);
            });
    }


    // Función para verificar el resultado de la ruta (corregida)
    function checkRouteResult(taskId) {
        if (!taskId) return;

        fetch(`/route-result/${taskId}`)
            .then(response => {
                if (!response.ok) {
                    // Si es 404, la tarea aún no está lista
                    if (response.status === 404) {
                        return { status: 'processing' };
                    }
                    throw new Error('Error en la respuesta del servidor');
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'completed') {
                    clearInterval(checkResultInterval);
                    displayRouteResult(data);
                } else if (data.error) {
                    clearInterval(checkResultInterval);
                    showError(data.error);
                }
                // Si está procesando, no hacemos nada y esperamos el siguiente intervalo
            })
            .catch(error => {
                clearInterval(checkResultInterval);
                showError('Error al verificar el estado de la ruta');
                console.error('Error:', error);
            });
    }

    // Función para mostrar el resultado de la ruta (corregida)
    function displayRouteResult(result) {
        loadingIndicator.classList.add('hidden');

        // Verificar si la respuesta es válida
        if (!result || result.error) {
            showError(result?.error || 'Respuesta inválida del servidor');
            return;
        }

        // Verificar si la respuesta está completa
        if (!result.summary || !result.path || !result.segments) {
            // Si no está completa pero no hay error, puede estar aún procesando
            if (result.status === 'processing') {
                return;
            }
            showError('Datos de ruta incompletos');
            return;
        }

        try {
            // Mostrar el resumen
            document.getElementById('total-distance').textContent = `${result.summary.total_distance_km?.toFixed(2) || '0.00'} km`;
            document.getElementById('total-time').textContent = `${result.summary.total_time_minutes?.toFixed(1) || '0.0'} min`;
            document.getElementById('safety-level').textContent = result.summary.safety_level || 'Desconocido';

            const optimizationType = result.metadata?.optimization || 'balanced';
            document.getElementById('optimization-type').textContent =
                optimizationType === 'balanced' ? 'Balanceada' :
                    optimizationType === 'shortest' ? 'Más corta' :
                        optimizationType === 'fastest' ? 'Más rápida' : 'Más segura';

            // Mostrar segmentos
            const segmentsList = document.getElementById('segments-list');
            segmentsList.innerHTML = '';

            if (result.segments && Array.isArray(result.segments)) {
                result.segments.forEach((segment, index) => {
                    const segmentEl = document.createElement('div');
                    segmentEl.className = 'segment-item';

                    segmentEl.innerHTML = `
                    <div class="segment-header">
                        <span>Segmento ${index + 1}</span>
                        <span>${segment.distance?.toFixed(0) || '0'} m</span>
                    </div>
                    <div class="segment-details">
                        <div class="segment-detail">
                            <span class="segment-detail-label">Tiempo</span>
                            <span>${segment.time?.toFixed(1) || '0.0'} s</span>
                        </div>
                        <div class="segment-detail">
                            <span class="segment-detail-label">Velocidad</span>
                            <span>${segment.speed?.toFixed(0) || '0'} km/h</span>
                        </div>
                        <div class="segment-detail">
                            <span class="segment-detail-label">Seguridad</span>
                            <span>${segment.safety_level || 'Desconocido'}</span>
                        </div>
                    </div>
                `;

                    segmentsList.appendChild(segmentEl);
                });
            }

            // Dibujar la ruta en el mapa si existe
            if (result.path && result.path.length > 0) {
                drawRouteOnMap(result.path);
            }

            // Mostrar los resultados
            resultsContent.classList.remove('hidden');
        } catch (error) {
            console.error('Error al mostrar resultados:', error);
            showError('Error al procesar los resultados de la ruta');
        }
    }

    // Función para verificar el resultado de la ruta
    function checkRouteResult(taskId) {
        if (!taskId) return;

        fetch(`/route-result/${taskId}`)
            .then(response => {
                if (!response.ok) {
                    // Si es 404, la tarea aún no está lista
                    if (response.status === 404) {
                        return { status: 'processing' };
                    }
                    throw new Error('Error en la respuesta del servidor');
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'completed') {
                    clearInterval(checkResultInterval);
                    displayRouteResult(data);
                } else if (data.error) {
                    clearInterval(checkResultInterval);
                    showError(data.error);
                }
                // Si está procesando, no hacemos nada y esperamos el siguiente intervalo
            })
            .catch(error => {
                clearInterval(checkResultInterval);
                showError('Error al verificar el estado de la ruta');
                console.error('Error:', error);
            });
    }

    function displayRouteResult(result) {
        loadingIndicator.classList.add('hidden');

        // Verificar si la respuesta es válida
        if (!result || result.error) {
            showError(result?.error || 'Respuesta inválida del servidor');
            return;
        }

        // Verificar si la respuesta está completa
        if (!result.summary || !result.path || !result.segments) {
            // Si no está completa pero no hay error, puede estar aún procesando
            if (result.status === 'processing') {
                return;
            }
            showError('Datos de ruta incompletos');
            return;
        }

        try {
            // Mostrar el resumen
            document.getElementById('total-distance').textContent = `${result.summary.total_distance_km?.toFixed(2) || '0.00'} km`;
            document.getElementById('total-time').textContent = `${result.summary.total_time_minutes?.toFixed(1) || '0.0'} min`;
            document.getElementById('safety-level').textContent = result.summary.safety_level || 'Desconocido';

            const optimizationType = result.metadata?.optimization || 'balanced';
            document.getElementById('optimization-type').textContent =
                optimizationType === 'balanced' ? 'Balanceada' :
                    optimizationType === 'shortest' ? 'Más corta' :
                        optimizationType === 'fastest' ? 'Más rápida' : 'Más segura';

            // Mostrar segmentos
            const segmentsList = document.getElementById('segments-list');
            segmentsList.innerHTML = '';

            if (result.segments && Array.isArray(result.segments)) {
                result.segments.forEach((segment, index) => {
                    const segmentEl = document.createElement('div');
                    segmentEl.className = 'segment-item';

                    segmentEl.innerHTML = `
                    <div class="segment-header">
                        <span>Segmento ${index + 1}</span>
                        <span>${segment.distance?.toFixed(0) || '0'} m</span>
                    </div>
                    <div class="segment-details">
                        <div class="segment-detail">
                            <span class="segment-detail-label">Tiempo</span>
                            <span>${segment.time?.toFixed(1) || '0.0'} s</span>
                        </div>
                        <div class="segment-detail">
                            <span class="segment-detail-label">Velocidad</span>
                            <span>${segment.speed?.toFixed(0) || '0'} km/h</span>
                        </div>
                        <div class="segment-detail">
                            <span class="segment-detail-label">Seguridad</span>
                            <span>${segment.safety_level || 'Desconocido'}</span>
                        </div>
                    </div>
                `;

                    segmentsList.appendChild(segmentEl);
                });
            }

            // Dibujar la ruta en el mapa si existe
            if (result.path && result.path.length > 0) {
                drawRouteOnMap(result.path);
            }

            // Mostrar los resultados
            resultsContent.classList.remove('hidden');
        } catch (error) {
            console.error('Error al mostrar resultados:', error);
            showError('Error al procesar los resultados de la ruta');
        }
    }

    // Función para dibujar la ruta en el mapa
    function drawRouteOnMap(path) {
        if (routeLayer) {
            map.removeLayer(routeLayer);
        }

        const latLngs = path.map(point => [point[0], point[1]]);
        routeLayer = L.polyline(latLngs, {
            color: '#3498db',
            weight: 5,
            opacity: 0.7,
            lineJoin: 'round'
        }).addTo(map);

        // Ajustar la vista del mapa para mostrar toda la ruta
        map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

        // Actualizar marcadores de inicio y fin
        updateStartMarker([path[0][0], path[0][1]]);
        updateEndMarker([path[path.length - 1][0], path[path.length - 1][1]]);
    }

    // Función para añadir un punto de seguridad
    function addSafetyPoint() {
        const pointId = Date.now();

        const pointEl = document.createElement('div');
        pointEl.className = 'safety-point';
        pointEl.innerHTML = `
            <button class="remove-safety-point" data-id="${pointId}">
                <i class="fas fa-times"></i>
            </button>
            <div class="form-row">
                <div class="form-group">
                    <label>Latitud</label>
                    <input type="number" step="0.000001" class="safety-lat" placeholder="Haz clic en 'Seleccionar en Mapa'">
                </div>
                <div class="form-group">
                    <label>Longitud</label>
                    <input type="number" step="0.000001" class="safety-lon" readonly>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Radio (m)</label>
                    <input type="number" step="1" class="safety-radius" placeholder="Ej: 200" value="200">
                </div>
                <div class="form-group">
                    <label>Índice Seguridad (1-5)</label>
                    <select class="safety-index">
                        <option value="1">1 (Muy seguro)</option>
                        <option value="2">2 (Seguro)</option>
                        <option value="3">3 (Moderado)</option>
                        <option value="4">4 (Inseguro)</option>
                        <option value="5">5 (Muy inseguro)</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Peso (0-1)</label>
                <input type="number" step="0.1" min="0" max="1" class="safety-weight" value="1.0">
            </div>
            <button class="btn btn-small select-safety-location" data-id="${pointId}">
                <i class="fas fa-map-marker-alt"></i> Seleccionar en mapa
            </button>
        `;

        safetyPointsContainer.appendChild(pointEl);

        // Añadir eventos
        pointEl.querySelector('.remove-safety-point').addEventListener('click', function () {
            const id = this.getAttribute('data-id');
            removeSafetyPoint(id);
        });

        pointEl.querySelector('.select-safety-location').addEventListener('click', function () {
            const id = this.getAttribute('data-id');
            setSelectionMode('safety', id); // Pasamos solo el ID
        });

        pointEl.querySelector('.safety-radius').addEventListener('change', function () {
            const id = pointId;
            const radius = parseFloat(this.value) || 200;
            const marker = safetyMarkers.find(m => m.id == id);
            if (marker) {
                map.removeLayer(marker.circle);
                const latlng = marker.marker.getLatLng();
                marker.circle = L.circle(latlng, {
                    radius: radius,
                    color: '#e74c3c',
                    fillColor: '#f8d7da',
                    fillOpacity: 0.2
                }).addTo(map);
            }
        });
    }

    // Función para añadir un punto de seguridad al mapa
    function addSafetyPointToMap(id, lat, lon, radius) {
        const marker = L.circleMarker([lat, lon], {
            radius: 8,
            color: '#e74c3c',
            fillColor: '#f8d7da',
            fillOpacity: 0.7
        }).addTo(map);

        // Círculo de radio
        const circle = L.circle([lat, lon], {
            radius: radius,
            color: '#e74c3c',
            fillColor: '#f8d7da',
            fillOpacity: 0.2
        }).addTo(map);

        safetyMarkers.push({ id, marker, circle });
    }

    // Función para eliminar un punto de seguridad
    function removeSafetyPoint(id) {
        // Eliminar del DOM
        const pointEl = document.querySelector(`.safety-point button[data-id="${id}"]`)?.parentNode;
        if (pointEl) {
            pointEl.remove();
        }

        // Eliminar marcadores del mapa
        const markerIndex = safetyMarkers.findIndex(m => m.id == id);
        if (markerIndex !== -1) {
            map.removeLayer(safetyMarkers[markerIndex].marker);
            map.removeLayer(safetyMarkers[markerIndex].circle);
            safetyMarkers.splice(markerIndex, 1);
        }
    }

    // Función para actualizar los valores de los sliders
    function updateWeightValue() {
        document.getElementById('distance-value').textContent = document.getElementById('distance-weight').value;
        document.getElementById('time-value').textContent = document.getElementById('time-weight').value;
        document.getElementById('safety-value').textContent = document.getElementById('safety-weight').value;
    }

    function updateWeightsVisibility() {
        const optimizationType = document.getElementById('optimization').value;
        const weightsSection = document.querySelector('.weights-sliders');

        if (optimizationType === 'balanced') {
            weightsSection.style.display = 'block';
        } else {
            weightsSection.style.display = 'none';
        }
    }

    // Función para mostrar errores
    function showError(message) {
        loadingIndicator.classList.add('hidden');
        errorMessage.classList.remove('hidden');
        document.getElementById('error-text').textContent = message;
    }

    // Inicializar con un punto de seguridad por defecto
    addSafetyPoint();
});