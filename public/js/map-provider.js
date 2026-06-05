import { MAP_CONFIG } from "./maps-config.js";

const GOOGLE_MAPS_SCRIPT_ID = "routesaver-google-maps";

export async function createMapController(options) {
  const wantsGoogle = MAP_CONFIG.preferredProvider === "google";
  const hasGoogleKey = Boolean(MAP_CONFIG.googleMapsApiKey.trim());

  if (wantsGoogle && hasGoogleKey) {
    const authFailureWatcher = createGoogleAuthFailureWatcher();
    let googleController = null;

    try {
      await authFailureWatcher.race(
        loadGoogleMapsApi(MAP_CONFIG.googleMapsApiKey.trim())
      );
      googleController = await authFailureWatcher.race(
        createGoogleMapController(options)
      );
      await authFailureWatcher.waitForValidation();
      return googleController;
    } catch (error) {
      console.warn("Google Maps indisponivel. Usando OpenStreetMap.", error);
      googleController?.destroy?.();
      resetMapContainer(options.containerId);
      return createLeafletMapController(
        options,
        "Google Maps bloqueado pela configuração da chave; usando OpenStreetMap"
      );
    } finally {
      authFailureWatcher.dispose();
    }
  }

  const fallbackReason = wantsGoogle
    ? "Configure a chave do Google Maps"
    : "";

  return createLeafletMapController(options, fallbackReason);
}

function createGoogleAuthFailureWatcher(validationTimeMs = 1800) {
  const previousAuthFailure = window.gm_authFailure;
  let rejectFailure;
  let disposed = false;

  const failurePromise = new Promise((_, reject) => {
    rejectFailure = reject;
  });

  window.gm_authFailure = () => {
    if (disposed) return;

    rejectFailure(new Error(
      "Google Maps recusou a chave. Verifique ativação, faturamento e restrições da chave."
    ));
  };

  return {
    race(promise) {
      return Promise.race([promise, failurePromise]);
    },

    waitForValidation() {
      return Promise.race([
        new Promise((resolve) => setTimeout(resolve, validationTimeMs)),
        failurePromise
      ]);
    },

    dispose() {
      disposed = true;

      if (previousAuthFailure) {
        window.gm_authFailure = previousAuthFailure;
      } else {
        delete window.gm_authFailure;
      }
    }
  };
}

function loadGoogleMapsApi(apiKey) {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }

  const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
  if (existingScript) {
    return waitForGoogleMaps();
  }

  return new Promise((resolve, reject) => {
    const callbackName = `initRouteSaverMaps_${Date.now()}`;
    const script = document.createElement("script");
    let settled = false;

    const cleanUp = () => {
      delete window[callbackName];
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve();
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanUp();
      reject(error);
    };

    window[callbackName] = () => {
      resolveOnce();
    };

    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      script.remove();
      rejectOnce(new Error("Falha ao carregar Google Maps."));
    };

    const params = new URLSearchParams({
      key: apiKey,
      v: MAP_CONFIG.googleMapsVersion || "beta",
      language: MAP_CONFIG.googleMapsLanguage || "pt-BR",
      region: MAP_CONFIG.googleMapsRegion || "BR",
      loading: "async",
      callback: callbackName
    });

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;

    document.head.appendChild(script);
  });
}

function resetMapContainer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.replaceChildren();
  container.removeAttribute("style");
  container.classList.remove("gm-style");
}

function waitForGoogleMaps() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (window.google?.maps?.importLibrary) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startedAt > 10000) {
        clearInterval(timer);
        reject(new Error("Tempo excedido ao carregar Google Maps."));
      }
    }, 100);
  });
}

function createLeafletMapController({ containerId, center, zoom }, fallbackReason) {
  if (!window.L) {
    throw new Error("Leaflet nao foi carregado.");
  }

  const isMobileLayout = window.matchMedia("(max-width: 980px)").matches;
  const map = L.map(containerId, {
    zoomControl: !isMobileLayout
  }).setView([center.lat, center.lng], zoom);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  return {
    provider: "leaflet",
    providerLabel: "OpenStreetMap",
    fallbackReason,
    routeWarning: "",
    routeProvider: "openrouteservice",
    routeTravelMode: "driving-car",

    onClick(handler) {
      map.on("click", (event) => {
        handler({
          lat: event.latlng.lat,
          lng: event.latlng.lng
        });
      });
    },

    addNumberedMarker(lat, lng, number) {
      return L.marker([lat, lng], {
        icon: createLeafletTextIcon(
          "custom-number-marker",
          String(number),
          [28, 28],
          [14, 14]
        )
      }).addTo(map);
    },

    addSpecialMarker(lat, lng, label, className) {
      return L.marker([lat, lng], {
        icon: createLeafletTextIcon(
          className,
          label,
          [34, 34],
          [17, 17]
        )
      }).addTo(map);
    },

    drawPolyline(points, style = {}) {
      return L.polyline(
        points.map((point) => [point.lat, point.lng]),
        {
          color: style.color || "#38bdf8",
          weight: style.weight || 5,
          opacity: style.opacity ?? 0.95,
          dashArray: style.approximate ? "8 10" : undefined
        }
      ).addTo(map);
    },

    removeLayer(layer) {
      if (layer && map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    },

    setView(lat, lng, targetZoom) {
      map.setView([lat, lng], targetZoom);
    },

    getCenter() {
      const currentCenter = map.getCenter();
      return {
        lat: currentCenter.lat,
        lng: currentCenter.lng
      };
    },

    resize() {
      map.invalidateSize({
        pan: false
      });
    },

    openPopup(lat, lng, content, onClose) {
      const popup = L.popup()
        .setLatLng([lat, lng])
        .setContent(content);

      if (onClose) {
        popup.on("remove", onClose);
      }

      popup.openOn(map);
      return popup;
    },

    closePopup(popup) {
      if (popup) {
        map.closePopup(popup);
      }
    },

    fitPoints(points, padding = 50) {
      if (!points.length) return;

      const bounds = L.latLngBounds(
        points.map((point) => [point.lat, point.lng])
      );

      map.fitBounds(bounds, {
        padding: [padding, padding]
      });
    }
  };
}

function createLeafletTextIcon(className, label, iconSize, iconAnchor) {
  const content = document.createElement("div");
  content.className = className;
  content.textContent = label;

  return L.divIcon({
    className: "",
    html: content,
    iconSize,
    iconAnchor
  });
}

async function createGoogleMapController({ containerId, center, zoom }) {
  const isMobileLayout = window.matchMedia("(max-width: 980px)").matches;
  const [
    { Map, InfoWindow },
    { AdvancedMarkerElement, PinElement },
    { Route }
  ] = await Promise.all([
    google.maps.importLibrary("maps"),
    google.maps.importLibrary("marker"),
    google.maps.importLibrary("routes")
  ]);

  const map = new Map(document.getElementById(containerId), {
    center,
    zoom,
    mapTypeControl: !isMobileLayout,
    streetViewControl: false,
    fullscreenControl: !isMobileLayout,
    gestureHandling: "greedy",
    mapId: MAP_CONFIG.googleMapId || "DEMO_MAP_ID"
  });

  return {
    provider: "google",
    providerLabel: "Google Maps",
    fallbackReason: "",
    routeProvider: "google",
    routeTravelMode: MAP_CONFIG.googleRouteTravelMode || "DRIVING",
    routeWarning:
      MAP_CONFIG.googleRouteTravelMode === "TWO_WHEELER"
        ? "Rotas de moto podem conter imprecisões"
        : "",

    destroy() {
      google.maps.event.clearInstanceListeners(map);
      resetMapContainer(containerId);
    },

    onClick(handler) {
      map.addListener("click", (event) => {
        if (!event.latLng) return;

        handler({
          lat: event.latLng.lat(),
          lng: event.latLng.lng()
        });
      });
    },

    addNumberedMarker(lat, lng, number) {
      return createGoogleAdvancedMarker(AdvancedMarkerElement, PinElement, {
        map,
        position: { lat, lng },
        title: `Ponto ${number}`,
        zIndex: 20 + number,
        background: "#3b82f6",
        glyph: String(number),
        scale: 1.1
      });
    },

    addSpecialMarker(lat, lng, label, className) {
      const isStart = className === "start-marker";

      return createGoogleAdvancedMarker(AdvancedMarkerElement, PinElement, {
        map,
        position: { lat, lng },
        title: label,
        zIndex: 100,
        background: isStart ? "#22c55e" : "#ef4444",
        glyph: isStart ? "I" : "F",
        scale: 1.2
      });
    },

    drawPolyline(points, style = {}) {
      const approximate = Boolean(style.approximate);

      return new google.maps.Polyline({
        map,
        path: points,
        strokeColor: style.color || "#38bdf8",
        strokeWeight: style.weight || 5,
        strokeOpacity: approximate ? 0 : style.opacity ?? 0.95,
        icons: approximate
          ? [
            {
              icon: {
                path: "M 0,-1 0,1",
                strokeColor: style.color || "#94a3b8",
                strokeOpacity: style.opacity ?? 0.75,
                scale: 3
              },
              offset: "0",
              repeat: "18px"
            }
          ]
          : undefined
      });
    },

    removeLayer(layer) {
      if (layer?.setMap) {
        layer.setMap(null);
      } else if (layer && "map" in layer) {
        layer.map = null;
      }
    },

    setView(lat, lng, targetZoom) {
      map.setCenter({ lat, lng });
      map.setZoom(targetZoom);
    },

    getCenter() {
      const currentCenter = map.getCenter();
      return currentCenter
        ? {
          lat: currentCenter.lat(),
          lng: currentCenter.lng()
        }
        : { ...center };
    },

    resize() {
      const currentCenter = map.getCenter();
      google.maps.event.trigger(map, "resize");
      if (currentCenter) {
        map.setCenter(currentCenter);
      }
    },

    openPopup(lat, lng, content, onClose) {
      const popup = new InfoWindow({
        content,
        position: { lat, lng }
      });

      if (onClose) {
        popup.addListener("closeclick", onClose);
      }

      popup.open({
        map,
        shouldFocus: false
      });

      return popup;
    },

    closePopup(popup) {
      popup?.close();
    },

    fitPoints(points, padding = 50) {
      if (!points.length) return;

      const bounds = new google.maps.LatLngBounds();
      points.forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, padding);
    },

    async searchPlaces(query, limit = 5) {
      const { Place } = await google.maps.importLibrary("places");
      const { places } = await Place.searchByText({
        textQuery: query,
        fields: ["displayName", "formattedAddress", "location"],
        locationBias: map.getCenter(),
        language: "pt-BR",
        region: "br",
        maxResultCount: limit
      });

      return (places || [])
        .filter((place) => place.location)
        .map((place) => ({
          title: place.displayName || "Local encontrado",
          displayName: place.formattedAddress || place.displayName || "",
          lat: place.location.lat(),
          lng: place.location.lng()
        }));
    },

    async calculateRoute(points) {
      const response = await Route.computeRoutes({
        origin: points[0],
        destination: points[points.length - 1],
        intermediates: points.slice(1, -1).map((point) => ({
          location: point
        })),
        travelMode: MAP_CONFIG.googleRouteTravelMode || "DRIVING",
        routingPreference: "TRAFFIC_UNAWARE",
        polylineQuality: "HIGH_QUALITY",
        fields: ["distanceMeters", "path"]
      });

      const route = response.routes?.[0];
      if (!route?.distanceMeters || !route.path?.length) {
        throw new Error("Google Maps nao retornou uma rota valida.");
      }

      return {
        distance: route.distanceMeters / 1000,
        provider: "google",
        travelMode: MAP_CONFIG.googleRouteTravelMode || "DRIVING",
        geometry: route.path.map((point) => ({
          lat: point.lat,
          lng: point.lng
        }))
      };
    }
  };
}

function createGoogleAdvancedMarker(
  AdvancedMarkerElement,
  PinElement,
  { map, position, title, zIndex, background, glyph, scale }
) {
  const marker = new AdvancedMarkerElement({
    position,
    title,
    zIndex
  });

  marker.append(new PinElement({
    background,
    borderColor: "#ffffff",
    glyphColor: "#ffffff",
    glyphText: glyph,
    scale
  }));

  marker.map = map;
  return marker;
}
