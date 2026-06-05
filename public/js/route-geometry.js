export const ROUTE_GEOMETRY_FORMAT = "encoded-polyline-5";

export function encodeRouteGeometry(points) {
  const normalizedPoints = normalizeGeometryPoints(points);
  let previousLat = 0;
  let previousLng = 0;
  let encoded = "";

  normalizedPoints.forEach((point) => {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);

    encoded += encodeSignedValue(lat - previousLat);
    encoded += encodeSignedValue(lng - previousLng);

    previousLat = lat;
    previousLng = lng;
  });

  return encoded;
}

export function decodeRouteGeometry(encoded) {
  if (typeof encoded !== "string" || !encoded) return [];

  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const latResult = decodeSignedValue(encoded, index);
    if (!latResult) return [];

    index = latResult.nextIndex;
    const lngResult = decodeSignedValue(encoded, index);
    if (!lngResult) return [];

    index = lngResult.nextIndex;
    lat += latResult.value;
    lng += lngResult.value;

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5
    });
  }

  return normalizeGeometryPoints(points);
}

export function getStoredRouteGeometry(route) {
  if (
    route?.geometryFormat === ROUTE_GEOMETRY_FORMAT &&
    typeof route.geometryEncoded === "string"
  ) {
    return decodeRouteGeometry(route.geometryEncoded);
  }

  if (Array.isArray(route?.geometry)) {
    return normalizeGeometryPoints(route.geometry);
  }

  return [];
}

export function normalizeGeometryPoints(points) {
  if (!Array.isArray(points)) return [];

  return points
    .map((point) => ({
      lat: Number(point?.lat),
      lng: Number(point?.lng)
    }))
    .filter(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        point.lat >= -90 &&
        point.lat <= 90 &&
        point.lng >= -180 &&
        point.lng <= 180
    );
}

function encodeSignedValue(value) {
  let shiftedValue = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";

  while (shiftedValue >= 0x20) {
    encoded += String.fromCharCode((0x20 | (shiftedValue & 0x1f)) + 63);
    shiftedValue >>= 5;
  }

  return encoded + String.fromCharCode(shiftedValue + 63);
}

function decodeSignedValue(encoded, startIndex) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte;

  do {
    if (index >= encoded.length || shift > 30) return null;

    byte = encoded.charCodeAt(index++) - 63;
    if (byte < 0) return null;

    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    value: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index
  };
}
