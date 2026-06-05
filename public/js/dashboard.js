const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjRiM2ZmYzgyMTk4ODQ5NGE5YzM0ZGNjOTBkOGM3ZGMzIiwiaCI6Im11cm11cjY0In0=";
import { auth, db } from "./firebase-config.js";
import { createMapController } from "./map-provider.js";
import {
    ROUTE_GEOMETRY_FORMAT,
    encodeRouteGeometry,
    getStoredRouteGeometry
} from "./route-geometry.js";
import {
    collection,
    addDoc,
    getDocs,
    deleteDoc,
    updateDoc,
    doc,
    query,
    where,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/* =========================================================
   ELEMENTOS
========================================================= */
const logoutBtn = document.getElementById("logout-btn");
const startRouteBtn = document.getElementById("start-route-btn");
const undoPointBtn = document.getElementById("undo-point-btn");
const clearRouteBtn = document.getElementById("clear-route-btn");
const saveRouteBtn = document.getElementById("save-route-btn");

const routeNameInput = document.getElementById("route-name");
const routeStatusEl = document.getElementById("route-status");
const routePointsCountEl = document.getElementById("route-points-count");
const routeDistanceEl = document.getElementById("route-distance");
const routesListEl = document.getElementById("routes-list");
const routesCounterEl = document.getElementById("routes-counter");

const statTotalRoutesEl = document.getElementById("stat-total-routes");
const statTotalKmEl = document.getElementById("stat-total-km");
const statAvgKmEl = document.getElementById("stat-avg-km");

const searchRoutesInput = document.getElementById("search-routes-input");
const sortRoutesSelect = document.getElementById("sort-routes-select");

const customModal = document.getElementById("custom-modal");
const modalIcon = document.getElementById("modal-icon");
const modalTitle = document.getElementById("modal-title");
const modalMessage = document.getElementById("modal-message");
const modalInput = document.getElementById("modal-input");
const modalCloseBtn = document.getElementById("modal-close-btn");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const locationSearchInput = document.getElementById("location-search-input");
const locationSearchBtn = document.getElementById("location-search-btn");
const locationSearchResults = document.getElementById("location-search-results");
const mapProviderBadge = document.getElementById("map-provider-badge");
const routePreviewCard = document.querySelector(".route-preview-card");
const currentRoutePointsList = document.getElementById("current-route-points");
const mobileRoutePointsPanel = document.querySelector(".mobile-route-points-panel");
const mobileRoutePointsList = document.getElementById("current-route-points-mobile");
const mobileLocateBtn = document.getElementById("mobile-locate-btn");
const mobileUndoPointBtn = document.getElementById("mobile-undo-point-btn");
const mobileAddPointBtn = document.getElementById("mobile-add-point-btn");
const mobileFinishRouteBtn = document.getElementById("mobile-finish-route-btn");
const mobileRouteStatus = document.getElementById("mobile-route-status");
const mobileRouteDetails = document.getElementById("mobile-route-details");
const mobileRouteFeedback = document.getElementById("mobile-route-feedback");
const mobileLayoutMedia = window.matchMedia("(max-width: 980px)");
const ROUTE_CALCULATION_DELAY_MS = 900;

/* =========================================================
   MAPA
========================================================= */
const map = await createMapController({
    containerId: "map",
    center: {
        lat: -26.3044,
        lng: -48.8487
    },
    zoom: 13
});

mapProviderBadge.textContent = [
    map.providerLabel,
    map.fallbackReason,
    map.routeWarning
].filter(Boolean).join(" · ");

/* =========================================================
   ESTADO
========================================================= */
let currentUser = null;
let isDrawingRoute = false;

let tempPoints = [];
let tempMarkers = [];
let tempPolyline = null;
let currentRouteGeometry = [];
let currentRouteIsApproximate = true;
let isRouteCalculating = false;
let routeRevision = 0;
let calculatedRouteRevision = -1;
let currentRouteCalculationPromise = Promise.resolve();
let currentRouteAbortController = null;

let selectedRouteLayer = null;
let selectedRouteMarkers = [];
let selectedRoutePopup = null;
let selectedRouteRequestId = 0;
let selectedRouteAbortController = null;
let suppressSelectedRoutePopupClose = false;

let allRoutes = [];
let selectedRouteId = null;
let currentRouteDistance = 0;
let modalCloseTimeout = null;
let mobileFeedbackTimeout = null;
let routeCalculationTimer = null;
let routeCalculationTimerResolve = null;
let isRouteCalculationPending = false;

/* =========================================================
   AUTH
========================================================= */
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "../../index.html";
        return;
    }

    currentUser = user;
    loadRoutes();
});

logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        window.location.href = "../../index.html";
    } catch (error) {
        console.error("Erro ao sair:", error);
        showModal("Erro", "Não foi possível sair da conta.", "error");
    }
});

/* =========================================================
   EVENTOS
========================================================= */
startRouteBtn.addEventListener("click", toggleDrawingMode);
undoPointBtn.addEventListener("click", undoLastPoint);
clearRouteBtn.addEventListener("click", clearCurrentRoute);
saveRouteBtn.addEventListener("click", saveCurrentRoute);

searchRoutesInput.addEventListener("input", applyRoutesFilters);
sortRoutesSelect.addEventListener("change", applyRoutesFilters);

locationSearchBtn.addEventListener("click", searchLocationByName);
mobileUndoPointBtn.addEventListener("click", undoLastPoint);
mobileAddPointBtn.addEventListener("click", addPointAtMapCenter);
mobileFinishRouteBtn.addEventListener("click", finishMobileRoute);
mobileLocateBtn.addEventListener("click", centerMapOnCurrentLocation);

mobileLayoutMedia.addEventListener("change", ({ matches }) => {
    if (matches && isDrawingRoute) {
        setMobileRouteMode(true);
        return;
    }

    if (!matches) {
        setMobileRouteMode(false);
    }
});

const mobileRouteSummaryObserver = new MutationObserver(updateMobileRouteControls);
[routeStatusEl, routePointsCountEl, routeDistanceEl].forEach((element) => {
    mobileRouteSummaryObserver.observe(element, {
        childList: true,
        characterData: true,
        subtree: true
    });
});
updateMobileRouteControls();
renderCurrentRoutePoints();

locationSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        searchLocationByName();
    }
});

map.onClick(({ lat, lng }) => {
    if (!isDrawingRoute || document.body.classList.contains("mobile-route-mode")) return;
    addPointToCurrentRoute(lat, lng);
});

/* =========================================================
   MODAL
========================================================= */
function setModalLoading(isLoading, text = "Processando...") {
    if (isLoading) {
        modalCloseBtn.disabled = true;
        modalCancelBtn.disabled = true;
        modalCloseBtn.dataset.originalText = modalCloseBtn.textContent;
        modalCloseBtn.textContent = text;
    } else {
        modalCloseBtn.disabled = false;
        modalCancelBtn.disabled = false;
        if (modalCloseBtn.dataset.originalText) {
            modalCloseBtn.textContent = modalCloseBtn.dataset.originalText;
        }
    }
}

function resetModalState() {
    customModal.querySelectorAll(".route-segments-actions").forEach((element) => {
        element.remove();
    });

    // texto padrão
    modalTitle.textContent = "";
    modalMessage.textContent = "";

    // input
    modalInput.value = "";
    modalInput.placeholder = "Digite aqui...";
    modalInput.classList.add("hidden");
    modalInput.onkeydown = null;
    modalInput.style.borderColor = "rgba(255,255,255,0.08)";
    modalInput.style.boxShadow = "none";

    // botões
    modalCloseBtn.textContent = "Fechar";
    modalCloseBtn.disabled = false;
    modalCloseBtn.onclick = null;
    modalCloseBtn.classList.remove("modal-half");

    modalCancelBtn.textContent = "Cancelar";
    modalCancelBtn.disabled = false;
    modalCancelBtn.onclick = null;
    modalCancelBtn.classList.add("hidden");
    modalCancelBtn.classList.remove("modal-half");
}

function startRouteInGoogleMaps(routeData) {
    if (!routeData) {
        showModal("Erro", "Não foi possível iniciar esta rota.");
        return;
    }

    let orderedPoints = [];

    if (Array.isArray(routeData.points) && routeData.points.length > 0) {
        orderedPoints = routeData.points
            .filter(p => p && typeof p.lat === "number" && typeof p.lng === "number")
            .map(p => ({
                lat: p.lat,
                lng: p.lng
            }));
    }

    else if (
        typeof routeData.lat === "number" &&
        typeof routeData.lng === "number"
    ) {
        orderedPoints = [
            {
                lat: routeData.lat,
                lng: routeData.lng
            }
        ];
    }

    if (orderedPoints.length < 2) {
        showModal(
            "Rota inválida",
            "Essa rota precisa ter pelo menos 2 pontos para iniciar no Google Maps."
        );
        return;
    }

    const isMobile =
        navigator.userAgentData?.mobile ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const maxWaypoints = isMobile ? 3 : 9;
    const intermediatePoints = orderedPoints.slice(1, -1);

    if (intermediatePoints.length > maxWaypoints) {
        showRouteSegmentsModal(
            orderedPoints,
            maxWaypoints,
            routeData.name || "Rota"
        );
        return;
    }

    openGoogleMapsUrl(buildGoogleMapsDirectionsUrl(orderedPoints));
}

function buildGoogleMapsDirectionsUrl(points) {
    const orderedPoints = points.filter(
        (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
    );
    const intermediatePoints = orderedPoints.slice(1, -1);
    const params = new URLSearchParams({
        api: "1",
        origin: formatPoint(orderedPoints[0]),
        destination: formatPoint(orderedPoints[orderedPoints.length - 1]),
        travelmode: "two-wheeler",
        dir_action: "navigate"
    });

    if (intermediatePoints.length) {
        params.set("waypoints", intermediatePoints.map(formatPoint).join("|"));
    }

    return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function formatPoint(point) {
    return `${point.lat},${point.lng}`;
}

function openGoogleMapsUrl(url) {
    const mapsWindow = window.open(url, "_blank");

    if (mapsWindow) {
        mapsWindow.opener = null;
    }
}

function createGoogleMapsSegments(points, maxWaypoints) {
    const maxPointsPerSegment = maxWaypoints + 2;
    const segments = [];
    let startIndex = 0;

    while (startIndex < points.length - 1) {
        const endIndex = Math.min(
            startIndex + maxPointsPerSegment - 1,
            points.length - 1
        );
        const segmentPoints = points.slice(startIndex, endIndex + 1);

        if (segmentPoints.length >= 2) {
            segments.push({
                startIndex,
                endIndex,
                points: segmentPoints,
                url: buildGoogleMapsDirectionsUrl(segmentPoints)
            });
        }

        if (endIndex >= points.length - 1) break;
        startIndex = endIndex;
    }

    return segments;
}

function showRouteSegmentsModal(points, maxWaypoints, routeName) {
    const segments = createGoogleMapsSegments(points, maxWaypoints);
    if (segments.length === 0) return;

    resetModalState();

    modalTitle.textContent = "Abrir rota em trechos";
    modalMessage.textContent =
        `${routeName} tem muitos pontos para abrir de uma vez no Google Maps. ` +
        "Abra os trechos em ordem.";
    modalIcon.textContent = "i";
    modalIcon.style.background = "rgba(59,130,246,0.14)";
    modalIcon.style.color = "#3b82f6";
    modalCloseBtn.textContent = "Fechar";
    modalCloseBtn.onclick = closeModal;

    const actions = document.createElement("div");
    actions.className = "route-segments-actions";

    segments.forEach((segment, index) => {
        const link = document.createElement("a");
        link.className = "route-segment-link";
        link.href = segment.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent =
            `Abrir trecho ${index + 1}: ponto ${segment.startIndex + 1} ao ${segment.endIndex + 1}`;
        actions.appendChild(link);
    });

    modalMessage.insertAdjacentElement("afterend", actions);
    customModal.classList.remove("hidden");

    requestAnimationFrame(() => {
        customModal.style.opacity = "1";
    });
}

function showModal(title, message, type = "success", options = {}) {
    resetModalState();

    modalTitle.textContent = title;
    modalMessage.textContent = message;

    if (type === "success") {
        modalIcon.textContent = "✓";
        modalIcon.style.background = "rgba(34,197,94,0.14)";
        modalIcon.style.color = "#22c55e";

        modalCloseBtn.onclick = closeModal;
    }

    else if (type === "error") {
        modalIcon.textContent = "!";
        modalIcon.style.background = "rgba(239,68,68,0.14)";
        modalIcon.style.color = "#ef4444";

        modalCloseBtn.onclick = closeModal;
    }

    else if (type === "confirm") {
        modalIcon.textContent = "?";
        modalIcon.style.background = "rgba(59,130,246,0.14)";
        modalIcon.style.color = "#3b82f6";

        modalCancelBtn.classList.remove("hidden");

        modalCloseBtn.textContent = options.confirmText || "Sim";
        modalCancelBtn.textContent = options.cancelText || "Não";

        // deixa os dois com largura bonita
        modalCloseBtn.classList.add("modal-half");
        modalCancelBtn.classList.add("modal-half");

        modalCloseBtn.onclick = async () => {
            if (options.onConfirm) {
                await options.onConfirm();
            } else {
                closeModal();
            }
        };

        modalCancelBtn.onclick = closeModal;
    }

    else {
        modalIcon.textContent = "i";
        modalIcon.style.background = "rgba(59,130,246,0.14)";
        modalIcon.style.color = "#3b82f6";

        modalCloseBtn.onclick = closeModal;
    }

    if (modalCloseTimeout) {
        clearTimeout(modalCloseTimeout);
        modalCloseTimeout = null;
    }

    customModal.classList.remove("hidden");

    requestAnimationFrame(() => {
        customModal.style.opacity = "1";
    });
}

function showInputModal(title, message, options = {}) {
    resetModalState();

    modalTitle.textContent = title;
    modalMessage.textContent = message;

    modalIcon.textContent = "✎";
    modalIcon.style.background = "rgba(59,130,246,0.14)";
    modalIcon.style.color = "#3b82f6";

    modalInput.classList.remove("hidden");
    modalCancelBtn.classList.remove("hidden");

    modalInput.value = options.defaultValue || "";
    modalInput.placeholder = options.placeholder || "Digite aqui...";

    modalCloseBtn.textContent = options.confirmText || "Salvar";
    modalCancelBtn.textContent = "Cancelar";

    modalCloseBtn.classList.add("modal-half");
    modalCancelBtn.classList.add("modal-half");

    modalCloseBtn.onclick = async () => {
        const value = modalInput.value.trim();

        if (!value) {
            modalInput.focus();
            modalInput.style.borderColor = "#ef4444";
            modalInput.style.boxShadow = "0 0 0 3px rgba(239,68,68,0.2)";
            return;
        }

        if (options.onConfirm) {
            await options.onConfirm(value);
        }
    };

    modalCancelBtn.onclick = closeModal;

    modalInput.onkeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            modalCloseBtn.click();
        }
    };

    if (modalCloseTimeout) {
        clearTimeout(modalCloseTimeout);
        modalCloseTimeout = null;
    }

    customModal.classList.remove("hidden");

    requestAnimationFrame(() => {
        customModal.style.opacity = "1";
    });

    setTimeout(() => {
        modalInput.focus();
        modalInput.select();
    }, 50);
}

function closeModal() {
    if (modalCloseTimeout) {
        clearTimeout(modalCloseTimeout);
        modalCloseTimeout = null;
    }

    customModal.style.opacity = "0";

    modalCloseTimeout = setTimeout(() => {
        customModal.classList.add("hidden");
        customModal.style.opacity = "";
        resetModalState();
        modalCloseTimeout = null;
    }, 180);
}

// fechar ao clicar fora
customModal.addEventListener("click", (e) => {
    if (e.target === customModal) {
        closeModal();
    }
});
// fechar com ESC
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !customModal.classList.contains("hidden")) {
        closeModal();
    }
});

/* =========================================================
   MODO DESENHO
========================================================= */
function toggleDrawingMode() {
    isDrawingRoute = !isDrawingRoute;

    if (isDrawingRoute) {
        startRouteBtn.textContent = "Finalizar";
        startRouteBtn.style.background = "#f59e0b";
        setMobileRouteMode(true);
    } else {
        startRouteBtn.textContent = "Iniciar rota";
        startRouteBtn.style.background = "#3b82f6";
        setMobileRouteMode(false);
    }

    updateRouteStatus();
}

function isMobileLayout() {
    return mobileLayoutMedia.matches;
}

function setMobileRouteMode(active) {
    const shouldActivate = Boolean(active && isMobileLayout());
    document.body.classList.toggle("mobile-route-mode", shouldActivate);

    window.setTimeout(() => map.resize?.(), 80);
    window.setTimeout(() => map.resize?.(), 320);
}

function finishMobileRoute() {
    if (!isDrawingRoute) return;

    isDrawingRoute = false;
    startRouteBtn.textContent = "Iniciar rota";
    startRouteBtn.style.background = "#3b82f6";
    setMobileRouteMode(false);
    updateRouteStatus();

    window.setTimeout(() => {
        routePreviewCard?.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }, 120);
}

function addPointAtMapCenter() {
    if (!isDrawingRoute) return;

    const center = map.getCenter?.();
    if (!center) {
        showMobileFeedback("Não foi possível identificar o centro do mapa.");
        return;
    }

    addPointToCurrentRoute(center.lat, center.lng);
    showMobileFeedback(`Ponto ${tempPoints.length} adicionado.`);
    navigator.vibrate?.(35);
}

function centerMapOnCurrentLocation() {
    if (!navigator.geolocation) {
        showMobileFeedback("Localização não disponível neste aparelho.");
        return;
    }

    mobileLocateBtn.disabled = true;
    mobileLocateBtn.textContent = "Localizando...";

    navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
            map.setView(coords.latitude, coords.longitude, 17);
            showMobileFeedback("Mapa centralizado na sua localização.");
            mobileLocateBtn.disabled = false;
            mobileLocateBtn.textContent = "Minha localização";
        },
        (error) => {
            const denied = error.code === error.PERMISSION_DENIED;
            showMobileFeedback(
                denied
                    ? "Permita o acesso à localização para usar este botão."
                    : "Não foi possível obter sua localização."
            );
            mobileLocateBtn.disabled = false;
            mobileLocateBtn.textContent = "Minha localização";
        },
        {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 30000
        }
    );
}

function updateMobileRouteControls() {
    const points = Number(routePointsCountEl.textContent) || 0;
    const pointLabel = points === 1 ? "ponto" : "pontos";

    mobileRouteStatus.textContent = routeStatusEl.textContent;
    mobileRouteDetails.textContent =
        `${points} ${pointLabel} · ${routeDistanceEl.textContent}`;
    mobileUndoPointBtn.disabled = points === 0;
}

function showMobileFeedback(message) {
    window.clearTimeout(mobileFeedbackTimeout);
    mobileRouteFeedback.textContent = message;
    mobileRouteFeedback.classList.add("visible");

    mobileFeedbackTimeout = window.setTimeout(() => {
        mobileRouteFeedback.classList.remove("visible");
    }, 2200);
}

function renderCurrentRoutePoints() {
    renderRoutePointsList(currentRoutePointsList);
    renderRoutePointsList(mobileRoutePointsList);
    mobileRoutePointsPanel?.classList.toggle("empty", tempPoints.length === 0);
}

function renderRoutePointsList(container) {
    if (!container) return;

    container.replaceChildren();

    if (tempPoints.length === 0) {
        const empty = document.createElement("p");
        empty.className = "route-points-empty";
        empty.textContent = "Nenhum ponto adicionado ainda.";
        container.appendChild(empty);
        return;
    }

    tempPoints.forEach((point, index) => {
        const item = document.createElement("div");
        item.className = "route-point-item";

        const info = document.createElement("div");
        const title = document.createElement("strong");
        const coords = document.createElement("span");
        title.className = "route-point-title";
        coords.className = "route-point-coords";
        title.textContent = getRoutePointTitle(point, index);
        coords.textContent = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
        info.append(title, coords);

        const actions = document.createElement("div");
        actions.className = "route-point-actions";
        actions.append(
            createRoutePointAction("Subir", index === 0, () => moveRoutePoint(index, -1)),
            createRoutePointAction(
                "Descer",
                index === tempPoints.length - 1,
                () => moveRoutePoint(index, 1)
            ),
            createRoutePointAction("Excluir", false, () => deleteRoutePoint(index), true)
        );

        item.append(info, actions);
        container.appendChild(item);
    });
}

function createRoutePointAction(label, disabled, onClick, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = danger
        ? "route-point-action route-point-delete"
        : "route-point-action";
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", onClick);
    return button;
}

function getRoutePointTitle(point, index) {
    if (point.label) {
        return `${index + 1}. ${point.label}`;
    }

    if (index === 0) return "1. Início";
    if (index === tempPoints.length - 1) return `${index + 1}. Fim`;
    return `${index + 1}. Ponto intermediário`;
}

function deleteRoutePoint(index) {
    if (index < 0 || index >= tempPoints.length) return;

    tempPoints.splice(index, 1);
    routeRevision++;
    redrawTempMarkers();
    updateCurrentRoutePreview();
    showMobileFeedback("Ponto excluído.");
}

function moveRoutePoint(index, direction) {
    const targetIndex = index + direction;
    if (
        index < 0 ||
        index >= tempPoints.length ||
        targetIndex < 0 ||
        targetIndex >= tempPoints.length
    ) {
        return;
    }

    const [point] = tempPoints.splice(index, 1);
    tempPoints.splice(targetIndex, 0, point);
    routeRevision++;
    redrawTempMarkers();
    updateCurrentRoutePreview();
    showMobileFeedback("Ordem dos pontos atualizada.");
}

function clearPendingRouteCalculation() {
    if (!routeCalculationTimer) return;

    window.clearTimeout(routeCalculationTimer);
    routeCalculationTimer = null;
    isRouteCalculationPending = false;

    if (routeCalculationTimerResolve) {
        routeCalculationTimerResolve();
        routeCalculationTimerResolve = null;
    }
}

/* =========================================================
   CRIAÇÃO DE ROTA
========================================================= */
function addPointToCurrentRoute(lat, lng, label = "") {
    tempPoints.push({
        lat,
        lng,
        ...(label ? { label } : {})
    });
    routeRevision++;

    const marker = map.addNumberedMarker(lat, lng, tempPoints.length);
    tempMarkers.push(marker);

    updateCurrentRoutePreview();
}

function undoLastPoint() {
    if (tempPoints.length === 0) return;

    tempPoints.pop();
    routeRevision++;

    const lastMarker = tempMarkers.pop();
    if (lastMarker) {
        map.removeLayer(lastMarker);
    }

    redrawTempMarkers();
    updateCurrentRoutePreview();
}

function clearCurrentRoute() {
    routeRevision++;
    clearPendingRouteCalculation();
    currentRouteAbortController?.abort();
    currentRouteAbortController = null;
    currentRouteCalculationPromise = Promise.resolve();

    tempPoints = [];
    currentRouteDistance = 0;
    currentRouteGeometry = [];
    currentRouteIsApproximate = true;
    isRouteCalculating = false;
    calculatedRouteRevision = -1;

    tempMarkers.forEach((marker) => map.removeLayer(marker));
    tempMarkers = [];

    if (tempPolyline) {
        map.removeLayer(tempPolyline);
        tempPolyline = null;
    }

    isDrawingRoute = false;
    setMobileRouteMode(false);
    routeStatusEl.textContent = "Aguardando";
    routePointsCountEl.textContent = "0";
    routeDistanceEl.textContent = "0.00 km";
    routeNameInput.value = "";

    startRouteBtn.textContent = "Iniciar rota";
    startRouteBtn.style.background = "#3b82f6";
    renderCurrentRoutePoints();
}

function updateCurrentRoutePreview() {
    routePointsCountEl.textContent = tempPoints.length;
    renderCurrentRoutePoints();
    currentRouteGeometry = [];
    currentRouteDistance = 0;
    currentRouteIsApproximate = true;
    calculatedRouteRevision = -1;

    clearPendingRouteCalculation();
    currentRouteAbortController?.abort();
    currentRouteAbortController = null;

    if (tempPoints.length < 2) {
        isRouteCalculationPending = false;
        isRouteCalculating = false;
        calculatedRouteRevision = routeRevision;
        routeDistanceEl.textContent = "0.00 km";
        drawPreviewRoute([], true);
        updateRouteStatus();
        currentRouteCalculationPromise = Promise.resolve();
        return;
    }

    isRouteCalculationPending = true;
    isRouteCalculating = false;
    routeDistanceEl.textContent = "Aguardando...";
    drawPreviewRoute(tempPoints, true);
    updateRouteStatus();

    const revision = routeRevision;
    const points = tempPoints.map((point) => ({ ...point }));

    currentRouteCalculationPromise = new Promise((resolve) => {
        routeCalculationTimerResolve = resolve;
        routeCalculationTimer = window.setTimeout(() => {
            routeCalculationTimer = null;
            routeCalculationTimerResolve = null;
            isRouteCalculationPending = false;

            updateDistancePreviewAsync(revision, points).finally(resolve);
        }, ROUTE_CALCULATION_DELAY_MS);
    });
}

async function updateDistancePreviewAsync(revision, points) {
    currentRouteAbortController?.abort();
    isRouteCalculationPending = false;

    if (points.length < 2) {
        currentRouteDistance = 0;
        currentRouteGeometry = [];
        currentRouteIsApproximate = true;
        isRouteCalculating = false;
        calculatedRouteRevision = revision;
        routeDistanceEl.textContent = "0.00 km";
        drawPreviewRoute([], true);
        updateRouteStatus();
        return;
    }

    const controller = new AbortController();
    currentRouteAbortController = controller;
    isRouteCalculating = true;
    routeDistanceEl.textContent = "Calculando...";
    drawPreviewRoute(points, true);
    updateRouteStatus();

    try {
        const routeResult = await calculateRoute(points, controller.signal);

        if (revision !== routeRevision) return;

        currentRouteDistance = routeResult.distance;
        currentRouteGeometry = routeResult.geometry;
        currentRouteIsApproximate = false;
        calculatedRouteRevision = revision;
        routeDistanceEl.textContent = `${routeResult.distance.toFixed(2)} km`;
        drawPreviewRoute(routeResult.geometry, false);
    } catch (error) {
        if (error.name === "AbortError" || revision !== routeRevision) return;

        console.warn("Rota viária indisponível, usando estimativa em linha reta.", error);
        const fallbackDistance = calculateDistanceFromPoints(points);
        currentRouteDistance = fallbackDistance;
        currentRouteGeometry = points;
        currentRouteIsApproximate = true;
        calculatedRouteRevision = revision;
        routeDistanceEl.textContent = `${fallbackDistance.toFixed(2)} km aprox.`;
        drawPreviewRoute(points, true);
    } finally {
        if (revision === routeRevision) {
            isRouteCalculating = false;
            updateRouteStatus();
        }
    }
}

function drawPreviewRoute(points, approximate) {
    if (tempPolyline) {
        map.removeLayer(tempPolyline);
        tempPolyline = null;
    }

    if (points.length < 2) return;

    tempPolyline = map.drawPolyline(points, {
        color: approximate ? "#94a3b8" : "#38bdf8",
        weight: 5,
        opacity: approximate ? 0.75 : 0.95,
        approximate
    });
}

function redrawTempMarkers() {
    tempMarkers.forEach((marker) => map.removeLayer(marker));
    tempMarkers = [];

    tempPoints.forEach((point, index) => {
        const marker = map.addNumberedMarker(point.lat, point.lng, index + 1);
        tempMarkers.push(marker);
    });
}

function updateRouteStatus() {
    if (tempPoints.length === 0) {
        routeStatusEl.textContent = isDrawingRoute ? "Desenhando rota" : "Aguardando";
        return;
    }

    if (isRouteCalculationPending) {
        routeStatusEl.textContent = "Aguardando cálculo";
        return;
    }

    if (isRouteCalculating) {
        routeStatusEl.textContent = "Calculando pelas vias";
        return;
    }

    if (currentRouteIsApproximate) {
        routeStatusEl.textContent = isDrawingRoute
            ? "Desenhando (aprox.)"
            : "Prévia aproximada";
        return;
    }

    routeStatusEl.textContent = isDrawingRoute ? "Desenhando rota" : "Prévia pronta";
}

/* =========================================================
   SALVAR
========================================================= */
async function saveCurrentRoute() {
    if (!currentUser) {
        showModal("Erro", "Usuário não autenticado.", "error");
        return;
    }

    if (tempPoints.length < 2) {
        showModal("Atenção", "Adicione pelo menos 2 pontos para salvar a rota.", "info");
        return;
    }

    const routeName = routeNameInput.value.trim();
    if (!routeName) {
        showModal("Atenção", "Digite um nome para a rota.", "info");
        return;
    }

    try {
        saveRouteBtn.disabled = true;
        saveRouteBtn.textContent = "Finalizando rota...";

        while (
            tempPoints.length >= 2 &&
            calculatedRouteRevision !== routeRevision
        ) {
            await currentRouteCalculationPromise;
        }

        if (tempPoints.length < 2) {
            showModal(
                "Salvamento cancelado",
                "A rota foi alterada antes de terminar o cálculo.",
                "info"
            );
            return;
        }

        const pointsToSave = tempPoints.map((point) => ({ ...point }));
        const geometryToSave =
            currentRouteGeometry.length >= 2
                ? currentRouteGeometry
                : pointsToSave;
        const finalDistance =
            currentRouteDistance || calculateDistanceFromPoints(pointsToSave);
        const geometryFields = createRouteGeometryFields(geometryToSave, {
            provider: currentRouteIsApproximate
                ? "approximate"
                : map.routeProvider,
            travelMode: currentRouteIsApproximate
                ? "straight-line"
                : map.routeTravelMode
        });

        await addDoc(collection(db, "routes"), {
            userId: currentUser.uid,
            name: routeName,
            points: pointsToSave,
            distance: finalDistance,
            distanceApproximate: currentRouteIsApproximate,
            ...geometryFields,
            geometryCalculatedAt: serverTimestamp(),
            createdAt: serverTimestamp()
        });

        const savedMessage = currentRouteIsApproximate
            ? "Sua rota foi salva com uma distância aproximada."
            : "Sua rota foi salva com sucesso.";

        showModal("Rota salva!", savedMessage);
        clearCurrentRoute();
        loadRoutes();


    } catch (error) {
        console.error("Erro ao salvar rota:", error);
        showModal("Erro", `Não foi possível salvar a rota. ${error.message || ""}`, "error");
    } finally {
        saveRouteBtn.disabled = false;
        saveRouteBtn.textContent = "Salvar rota";
    }
}


/* =========================================================
   LISTAGEM
========================================================= */
async function loadRoutes() {
    if (!currentUser) return;

    setContainerMessage(routesListEl, "Carregando rotas...");

    try {
        const routesRef = collection(db, "routes");
        const q = query(
            routesRef,
            where("userId", "==", currentUser.uid),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);
        allRoutes = [];

        snapshot.forEach((docSnap) => {
            allRoutes.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });

        applyRoutesFilters();
        updateDashboardStats(allRoutes);
    } catch (error) {
        console.error("Erro ao carregar rotas:", error);
        setContainerMessage(routesListEl, "Erro ao carregar rotas.");
    }
}

function applyRoutesFilters() {
    const searchTerm = searchRoutesInput.value.trim().toLowerCase();
    const sortValue = sortRoutesSelect.value;

    let filteredRoutes = [...allRoutes];

    if (searchTerm) {
        filteredRoutes = filteredRoutes.filter((route) =>
            (route.name || "").toLowerCase().includes(searchTerm)
        );
    }

    filteredRoutes.sort((a, b) => {
        switch (sortValue) {
            case "oldest":
                return getCreatedAtMs(a) - getCreatedAtMs(b);

            case "name-asc":
                return (a.name || "").localeCompare(b.name || "");

            case "name-desc":
                return (b.name || "").localeCompare(a.name || "");

            case "distance-desc":
                return (b.distance || 0) - (a.distance || 0);

            case "distance-asc":
                return (a.distance || 0) - (b.distance || 0);

            case "recent":
            default:
                return getCreatedAtMs(b) - getCreatedAtMs(a);
        }
    });

    renderRoutesList(filteredRoutes);
}

function renderRoutesList(routes) {
    routesCounterEl.textContent = routes.length;

    if (routes.length === 0) {
        setContainerMessage(routesListEl, "Nenhuma rota encontrada.");
        return;
    }

    routesListEl.replaceChildren();

    routes.forEach((route) => {
        renderRouteCard(route.id, route);
    });
}

function renderRouteCard(routeId, route) {
    const card = document.createElement("div");
    card.className = "route-card";

    if (selectedRouteId === routeId) {
        card.classList.add("active");
    }

    const points = getNormalizedRoutePoints(route);
    const title = document.createElement("h3");
    title.textContent = route.name || "Rota sem nome";

    const pointsInfo = createInfoLine("Pontos:", String(points.length));
    const distanceSuffix = route.distanceApproximate ? " km aprox." : " km";
    const distanceInfo = createInfoLine(
        "Distância:",
        `${(route.distance || 0).toFixed(2)}${distanceSuffix}`
    );
    const sourceInfo = createInfoLine(
        "Traçado:",
        getRouteSourceLabel(route)
    );

    const actions = document.createElement("div");
    actions.className = "route-card-actions";

    const viewBtn = createActionButton("view-btn", "Ver");
    const startBtn = createActionButton("start-btn", "Iniciar rota");
    const renameBtn = createActionButton("rename-btn", "Renomear");
    const deleteBtn = createActionButton("delete-btn", "Excluir");

    actions.append(viewBtn, startBtn, renameBtn, deleteBtn);
    card.append(title, pointsInfo, distanceInfo, sourceInfo, actions);

    viewBtn.addEventListener("click", () => {
        selectedRouteId = routeId;
        highlightRoute(route);
        applyRoutesFilters();
    });

    startBtn.addEventListener("click", () => {
        startRouteInGoogleMaps(route);
    });

    renameBtn.addEventListener("click", () => {
        showInputModal("Renomear rota", "Digite o novo nome da rota:", {
            defaultValue: route.name || "",
            placeholder: "Novo nome da rota",
            confirmText: "Salvar",
            onConfirm: async (newName) => {
                const finalName = (newName || "").trim();

                try {
                    setModalLoading(true, "Salvando...");

                    const routeRef = doc(db, "routes", routeId);

                    await updateDoc(routeRef, {
                        name: finalName
                    });

                    allRoutes = allRoutes.map((item) =>
                        item.id === routeId
                            ? { ...item, name: finalName }
                            : item
                    );

                    closeModal();
                    applyRoutesFilters();
                    showModal("Rota renomeada!", "O nome da rota foi atualizado com sucesso.", "success");
                    loadRoutes();

                } catch (error) {
                    console.error("Erro ao renomear rota:", error);
                    showModal("Erro", "Não foi possível renomear a rota.", "error");
                } finally {
                    setModalLoading(false);
                }
            }
        });
    });

    deleteBtn.addEventListener("click", () => {
        showModal(
            "Excluir rota",
            `Deseja realmente excluir a rota "${route.name || "sem nome"}"?`,
            "confirm",
            {
                confirmText: "Sim",
                cancelText: "Não",
                onConfirm: async () => {
                    try {
                        setModalLoading(true, "Excluindo...");

                        await deleteDoc(doc(db, "routes", routeId));

                        if (selectedRouteId === routeId) {
                            selectedRouteId = null;
                            clearSelectedRoute();
                        }

                        closeModal();
                        showModal("Rota excluída!", "A rota foi removida com sucesso.");
                        loadRoutes();
                    } catch (error) {
                        console.error("Erro ao excluir rota:", error);
                        showModal("Erro", "Não foi possível excluir a rota.", "error");
                    } finally {
                        setModalLoading(false);
                    }
                }
            }
        );
    });

    routesListEl.appendChild(card);
}

/* =========================================================
   VISUALIZAR ROTA
========================================================= */
async function highlightRoute(route) {
    const points = getNormalizedRoutePoints(route);
    if (points.length < 1) return;

    clearSelectedRoute();
    const requestId = ++selectedRouteRequestId;
    const controller = new AbortController();
    selectedRouteAbortController = controller;

    points.forEach((point, index) => {
        const marker = map.addNumberedMarker(point.lat, point.lng, index + 1);
        selectedRouteMarkers.push(marker);
    });

    const startPoint = points[0];
    const startMarker = map.addSpecialMarker(
        startPoint.lat,
        startPoint.lng,
        "INÍCIO",
        "start-marker"
    );
    selectedRouteMarkers.push(startMarker);

    const endPoint = points[points.length - 1];
    const endMarker = map.addSpecialMarker(
        endPoint.lat,
        endPoint.lng,
        "FIM",
        "end-marker"
    );
    selectedRouteMarkers.push(endMarker);

    const savedGeometry = getStoredRouteGeometry(route);
    let displayPoints = savedGeometry.length >= 2 ? savedGeometry : points;
    let distance = Number.isFinite(route.distance)
        ? route.distance
        : calculateDistanceFromPoints(points);
    let approximate = savedGeometry.length >= 2
        ? Boolean(route.distanceApproximate)
        : true;

    if (points.length >= 2 && (savedGeometry.length < 2 || approximate)) {
        try {
            const routeResult = await calculateRoute(points, controller.signal);

            if (requestId !== selectedRouteRequestId) return;

            displayPoints = routeResult.geometry;
            distance = routeResult.distance;
            approximate = false;
            route.geometryProvider = routeResult.provider || map.routeProvider;
            route.geometryTravelMode = routeResult.travelMode || map.routeTravelMode;

            persistCalculatedRouteGeometry(route, routeResult);
        } catch (error) {
            if (error.name === "AbortError" || requestId !== selectedRouteRequestId) return;
            console.warn("Não foi possível recalcular a rota salva.", error);
        }
    }

    if (requestId !== selectedRouteRequestId) return;

    const routeHalo = map.drawPolyline(displayPoints, {
        color: "#93c5fd",
        weight: 12,
        opacity: 0.25,
        approximate
    });
    selectedRouteMarkers.push(routeHalo);

    selectedRouteLayer = map.drawPolyline(displayPoints, {
        color: approximate ? "#94a3b8" : "#2563eb",
        weight: 6,
        opacity: 1,
        approximate
    });

    const center = getCenterPoint(displayPoints);
    const popupContent = createRoutePopupContent(route, points.length, distance, approximate);

    selectedRoutePopup = map.openPopup(center.lat, center.lng, popupContent, () => {
        if (suppressSelectedRoutePopupClose) return;

        clearSelectedRoute({ closePopup: false });
        selectedRouteId = null;
        applyRoutesFilters();
    });

    map.fitPoints(displayPoints, 50);
}

function clearSelectedRoute({ closePopup = true } = {}) {
    selectedRouteRequestId++;
    selectedRouteAbortController?.abort();
    selectedRouteAbortController = null;

    if (selectedRouteLayer) {
        map.removeLayer(selectedRouteLayer);
        selectedRouteLayer = null;
    }

    selectedRouteMarkers.forEach((marker) => map.removeLayer(marker));
    selectedRouteMarkers = [];

    if (selectedRoutePopup && closePopup) {
        const popup = selectedRoutePopup;
        selectedRoutePopup = null;
        suppressSelectedRoutePopupClose = true;
        map.closePopup(popup);

        queueMicrotask(() => {
            suppressSelectedRoutePopupClose = false;
        });
    } else if (!closePopup) {
        selectedRoutePopup = null;
    }
}

/* =========================================================
   DASHBOARD STATS
========================================================= */
function updateDashboardStats(routes) {
    const totalRoutes = routes.length;
    const totalKm = routes.reduce((sum, route) => sum + (route.distance || 0), 0);
    const avgKm = totalRoutes > 0 ? totalKm / totalRoutes : 0;

    statTotalRoutesEl.textContent = totalRoutes;
    statTotalKmEl.textContent = totalKm.toFixed(2);
    statAvgKmEl.textContent = avgKm.toFixed(2);
}

/* =========================================================
   BUSCA DE LOCAL
========================================================= */
async function searchLocationByName() {
    const query = locationSearchInput.value.trim();

    if (!query) {
        if (document.body.classList.contains("mobile-route-mode")) {
            showMobileFeedback("Digite um local para buscar.");
        } else {
            showModal("Atenção", "Digite um local para buscar.", "info");
        }
        return;
    }

    setContainerMessage(locationSearchResults, "Buscando...", "location-search-empty");

    try {
        let results;

        if (map.provider === "google") {
            try {
                results = await map.searchPlaces(query, 5);
            } catch (error) {
                console.warn("Google Places indisponível, usando OpenStreetMap.", error);
                results = await searchPlacesWithNominatim(query);
            }
        } else {
            results = await searchPlacesWithNominatim(query);
        }

        renderLocationSearchResults(results);
    } catch (error) {
        console.error("Erro ao buscar local:", error);
        setContainerMessage(locationSearchResults, "Erro ao buscar local.", "location-search-empty");
    }
}

function renderLocationSearchResults(results) {
    if (!results || results.length === 0) {
        setContainerMessage(
            locationSearchResults,
            "Nenhum local encontrado.",
            "location-search-empty"
        );
        return;
    }

    locationSearchResults.replaceChildren();

    results.forEach((place) => {
        const item = document.createElement("div");
        item.className = "location-result-item";

        const title = place.title || "Local encontrado";
        const itemTitle = document.createElement("strong");
        const itemAddress = document.createElement("span");
        itemTitle.textContent = title;
        itemAddress.textContent = place.displayName || "";
        item.append(itemTitle, itemAddress);

        item.addEventListener("click", () => {
            const lat = Number(place.lat);
            const lng = Number(place.lng);

            map.setView(lat, lng, 16);

            if (!isMobileLayout()) {
                map.openPopup(
                    lat,
                    lng,
                    createLocationPopupContent(title, place.displayName || "")
                );
            }

            if (!isDrawingRoute) {
                toggleDrawingMode();
            }

            addPointToCurrentRoute(lat, lng, title);

            locationSearchInput.value = title;
            locationSearchResults.replaceChildren();

            if (isMobileLayout()) {
                showMobileFeedback(`"${title}" foi adicionado à rota.`);
                navigator.vibrate?.(35);
            } else {
                showModal("Ponto adicionado!", `"${title}" foi adicionado à rota.`);
            }
        });

        locationSearchResults.appendChild(item);
    });
}

async function searchPlacesWithNominatim(queryText) {
    const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryText)}&limit=5&addressdetails=1`
    );

    if (!response.ok) {
        throw new Error(`Nominatim HTTP ${response.status}`);
    }

    const results = await response.json();

    return results
        .map((place) => ({
            title:
                place.name ||
                place.display_name?.split(",")[0] ||
                "Local encontrado",
            displayName: place.display_name || "",
            lat: Number(place.lat),
            lng: Number(place.lon)
        }))
        .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
}

/* =========================================================
   UTILITÁRIOS
========================================================= */
function getNormalizedRoutePoints(route) {
    if (route.points && Array.isArray(route.points)) {
        return route.points.filter(
            (point) =>
                point &&
                Number.isFinite(point.lat) &&
                Number.isFinite(point.lng)
        );
    }

    if (Number.isFinite(route.lat) && Number.isFinite(route.lng)) {
        return [{ lat: route.lat, lng: route.lng }];
    }

    return [];
}

function createRouteGeometryFields(geometry, metadata = {}) {
    const geometryEncoded = encodeRouteGeometry(geometry);

    return {
        geometryEncoded,
        geometryFormat: ROUTE_GEOMETRY_FORMAT,
        geometryPointCount: Array.isArray(geometry) ? geometry.length : 0,
        geometryProvider: metadata.provider || "unknown",
        geometryTravelMode: metadata.travelMode || "unknown"
    };
}

function getRouteSourceLabel(route) {
    if (route.geometryProvider === "google") {
        return route.geometryTravelMode === "TWO_WHEELER"
            ? "Google Maps (moto)"
            : "Google Maps";
    }

    if (route.geometryProvider === "openrouteservice") {
        return "OpenRouteService (carro)";
    }

    if (route.geometryProvider === "approximate" || route.distanceApproximate) {
        return "Aproximado";
    }

    return route.geometryEncoded
        ? "Traçado salvo"
        : "Será salvo ao abrir";
}

function persistCalculatedRouteGeometry(route, routeResult) {
    if (!route?.id || !routeResult?.geometry?.length) return;

    const geometryFields = createRouteGeometryFields(routeResult.geometry, {
        provider: routeResult.provider || map.routeProvider,
        travelMode: routeResult.travelMode || map.routeTravelMode
    });

    updateDoc(doc(db, "routes", route.id), {
        ...geometryFields,
        distance: routeResult.distance,
        distanceApproximate: false,
        geometryCalculatedAt: serverTimestamp()
    }).then(() => {
        Object.assign(route, geometryFields, {
            distance: routeResult.distance,
            distanceApproximate: false
        });
    }).catch((error) => {
        console.warn("Não foi possível salvar o traçado recalculado.", error);
    });
}

function setContainerMessage(container, message, className = "") {
    const paragraph = document.createElement("p");
    paragraph.className = className;
    paragraph.textContent = message;
    container.replaceChildren(paragraph);
}

function createInfoLine(label, value) {
    const paragraph = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = label;
    paragraph.append(strong, document.createTextNode(` ${value}`));
    return paragraph;
}

function createActionButton(className, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    return button;
}

function createRoutePopupContent(route, pointCount, distance, approximate) {
    const content = document.createElement("div");
    content.className = "route-popup";

    const title = document.createElement("h4");
    title.textContent = route.name || "Rota sem nome";

    const pointsInfo = createInfoLine("Pontos:", String(pointCount));
    const distanceInfo = createInfoLine(
        "Distância:",
        `${distance.toFixed(2)} km${approximate ? " aprox." : ""}`
    );
    const sourceInfo = createInfoLine(
        "Traçado:",
        approximate ? "Aproximado" : getRouteSourceLabel(route)
    );

    content.append(title, pointsInfo, distanceInfo, sourceInfo);
    return content;
}

function createLocationPopupContent(title, address) {
    const content = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;

    content.append(heading);

    if (address) {
        content.append(document.createElement("br"), document.createTextNode(address));
    }

    return content;
}

function getCenterPoint(points) {
    const latitudes = points.map((point) => point.lat);
    const longitudes = points.map((point) => point.lng);

    return {
        lat: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
        lng: (Math.min(...longitudes) + Math.max(...longitudes)) / 2
    };
}

function calculateDistanceFromPoints(points) {
    if (!points || points.length < 2) return 0;

    let totalDistance = 0;

    for (let i = 0; i < points.length - 1; i++) {
        totalDistance += getDistanceInKm(
            points[i].lat,
            points[i].lng,
            points[i + 1].lat,
            points[i + 1].lng
        );
    }

    return totalDistance;
}

function getDistanceInKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(value) {
    return (value * Math.PI) / 180;
}

function getCreatedAtMs(route) {
    if (route.createdAt?.seconds) {
        return route.createdAt.seconds * 1000;
    }

    return 0;
}

/* =========================================================
   ROTA REAL PELAS VIAS
========================================================= */
async function calculateRoute(points, signal) {
    if (!points || points.length < 2) {
        return {
            distance: 0,
            geometry: []
        };
    }

    if (map.provider === "google" && map.calculateRoute) {
        try {
            return await map.calculateRoute(points);
        } catch (error) {
            if (map.routeTravelMode === "TWO_WHEELER") {
                console.warn(
                    "Google Routes para moto indisponível; usando estimativa pontilhada.",
                    error
                );
                throw error;
            }

            console.warn(
                "Google Routes indisponível, usando OpenRouteService.",
                error
            );
        }
    }

    return calculateRouteORS(points, signal);
}

async function calculateRouteORS(points, signal) {
    const coordinates = points.map((point) => [point.lng, point.lat]);
    const response = await fetch(
        "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
        {
            method: "POST",
            signal,
            headers: {
                "Authorization": ORS_API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                coordinates
            })
        }
    );

    if (!response.ok) {
        throw new Error(`OpenRouteService HTTP ${response.status}`);
    }

    const data = await response.json();
    const feature = data.features?.[0];
    const distanceMeters = feature?.properties?.summary?.distance;
    const geometry = feature?.geometry?.coordinates
        ?.map(([lng, lat]) => ({ lat, lng }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    const distance = distanceMeters / 1000;

    if (!distanceMeters || !Number.isFinite(distance) || !geometry?.length) {
        throw new Error("OpenRouteService retornou uma rota inválida.");
    }

    return {
        distance,
        provider: "openrouteservice",
        travelMode: "driving-car",
        geometry
    };
}
