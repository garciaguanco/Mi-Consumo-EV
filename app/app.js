import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD2OZ4h4_mQtbLMG9xNZE1FCaVjDR_1I9Q",
  authDomain: "my-ev-65d7c.firebaseapp.com",
  projectId: "my-ev-65d7c",
  storageBucket: "my-ev-65d7c.firebasestorage.app",
  messagingSenderId: "388409667959",
  appId: "1:388409667959:web:4bf82ac579430e79383172",
  measurementId: "G-D1SJ205ZM3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const STORAGE_KEY = "miBydCargas_v1";
const BATTERY_KWH = 45.12;
const WLTP_KM = 312;
const IVA_FACTOR = 1.22;
const $ = id => document.getElementById(id);

let charges = [];
let currentUser = null;
let cloudReady = false;
let isSaving = false;

const money = value => new Intl.NumberFormat("es-UY", {
  style: "currency", currency: "UYU", minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(value) || 0).replace("UYU", "$U");

const decimal = value => new Intl.NumberFormat("es-UY", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(value) || 0);

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function currentMonth() { return todayLocal().slice(0, 7); }

function readLocalCharges() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("No se pudieron leer las cargas locales.", error);
    return [];
  }
}
function saveLocalCharges() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(charges)); }
  catch (error) { console.warn("No se pudo guardar la copia local.", error); }
}
function setAuthMessage(message, type = "") {
  $("authMessage").textContent = message;
  $("authMessage").className = `auth-message ${type}`;
}
function setSyncStatus(message) { $("syncStatus").textContent = message; }
function showApp(user) {
  $("authView").hidden = Boolean(user);
  $("appView").hidden = !user;
  $("accountEmail").textContent = user
    ? `${user.displayName ? user.displayName + " · " : ""}${user.email || ""}` : "";
}
function chargesRef() {
  if (!currentUser) throw new Error("Iniciá sesión para acceder a tus cargas.");
  return collection(db, "users", currentUser.uid, "charges");
}
function selectedCharges() {
  const month = $("monthFilter").value;
  return charges.filter(c => String(c.date || "").slice(0, 7) === month)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) ||
      Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function render() {
  const list = selectedCharges();
  const totalCost = list.reduce((sum, c) => sum + Number(c.cost || 0), 0);
  const totalKwh = list.reduce((sum, c) => sum + Number(c.kwh || 0), 0);
  $("monthlyCost").textContent = money(totalCost);
  $("monthlyKwh").textContent = `${decimal(totalKwh)} kWh`;
  $("monthlyCount").textContent = `${list.length} ${list.length === 1 ? "carga registrada" : "cargas registradas"}`;
  $("averageKwh").textContent = totalKwh > 0 ? money(totalCost / totalKwh) : money(0);
  const price = Math.max(0, Number($("referencePrice").value) || 0);
  $("costPerKm").textContent = money(BATTERY_KWH * price / WLTP_KM);
  renderHistory(list);
  updateEstimate();
}

function renderHistory(list) {
  const body = $("historyBody");
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-state">Todavía no hay cargas registradas para este mes.</td></tr>';
    return;
  }
  body.innerHTML = "";
  list.forEach(charge => {
    const row = document.createElement("tr");
    [
      charge.date, charge.tariff, `${decimal(charge.kwh)} kWh`, money(charge.cost),
      Number(charge.kwh) > 0 ? money(charge.cost / charge.kwh) : money(0),
      charge.odometer ? `${new Intl.NumberFormat("es-UY").format(charge.odometer)} km` : "—"
    ].forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    const actionCell = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "delete-button";
    button.textContent = "Eliminar";
    button.setAttribute("aria-label", `Eliminar carga del ${charge.date}`);
    button.addEventListener("click", () => deleteCharge(charge.id));
    actionCell.appendChild(button);
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}

function updateEstimate() {
  const price = Math.max(0, Number($("referencePrice").value) || 0);
  const fullCharge = BATTERY_KWH * price;
  $("fullChargeEstimate").textContent = money(fullCharge);
  $("fullChargeWithIva").textContent = money(fullCharge * IVA_FACTOR);
  $("estimatedKmCost").textContent = money(fullCharge / WLTP_KM);
  const startRaw = $("startPercent").value;
  const endRaw = $("endPercent").value;
  if (startRaw === "" || endRaw === "") {
    $("kwh").value = "";
    $("cost").value = "";
    $("pricePreview").textContent = "Ingresá el porcentaje inicial y final para calcular la carga.";
    return;
  }
  const start = Number(startRaw), end = Number(endRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end) ||
      start < 0 || start > 100 || end < 0 || end > 100 || end < start) {
    $("kwh").value = "";
    $("cost").value = "";
    $("pricePreview").textContent = "Revisá los porcentajes: deben estar entre 0 y 100 y el final no puede ser menor que el inicial.";
    return;
  }
  const energy = BATTERY_KWH * (end - start) / 100;
  const totalCost = energy * price;
  $("kwh").value = energy.toFixed(2);
  $("cost").value = totalCost.toFixed(2);
  $("pricePreview").textContent = `Energía estimada: ${decimal(energy)} kWh · Costo estimado: ${money(totalCost)}`;
}
function showMessage(message, type = "") {
  $("formMessage").textContent = message;
  $("formMessage").className = `form-message ${type}`;
}
function friendlyError(error) {
  const messages = {
    "auth/invalid-email": "El correo electrónico no parece válido.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Probá iniciar sesión.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/user-not-found": "No encontramos una cuenta con ese correo.",
    "auth/wrong-password": "La contraseña no es correcta.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de terminar.",
    "auth/unauthorized-domain": "Dominio no autorizado. Agregá garciaguanco.github.io en Firebase Authentication > Configuración > Dominios autorizados.",
    "permission-denied": "Firebase bloqueó el acceso. Revisá las reglas de Firestore."
  };
  return messages[error?.code] || error?.message || "Ocurrió un error. Intentá nuevamente.";
}

async function loginEmail(event) {
  event.preventDefault();
  try {
    setAuthMessage("Iniciando sesión…");
    await signInWithEmailAndPassword(auth, $("authEmail").value.trim(), $("authPassword").value);
  } catch (error) {
    console.error(error);
    setAuthMessage(friendlyError(error), "error");
  }
}
async function registerEmail() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (!email || !password) return setAuthMessage("Ingresá correo y contraseña.", "error");
  try {
    setAuthMessage("Creando tu cuenta…");
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    setAuthMessage(friendlyError(error), "error");
  }
}
async function loginGoogle() {
  try {
    setAuthMessage("Abriendo Google…");
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error(error);
    setAuthMessage(friendlyError(error), "error");
  }
}

async function loadCloudAndMergeLocal() {
  setSyncStatus("Cargando tus registros desde la nube…");
  const cloudSnapshot = await getDocs(chargesRef());
  const cloudRecords = cloudSnapshot.docs.map(d => ({ ...d.data(), id: d.id }));
  const cloudIds = new Set(cloudRecords.map(c => String(c.id)));
  const localRecords = readLocalCharges();
  const toUpload = localRecords.filter(c => c && c.id && !cloudIds.has(String(c.id)));

  // Importa las cargas locales que aún no estén en la nube.
  for (const item of toUpload) {
    const { id, ...data } = item;
    await setDoc(doc(db, "users", currentUser.uid, "charges", String(id)), {
      ...data, id: String(id), createdAt: Number(data.createdAt) || Date.now()
    });
  }
  const finalSnapshot = toUpload.length ? await getDocs(chargesRef()) : cloudSnapshot;
  charges = finalSnapshot.docs.map(d => ({ ...d.data(), id: d.id }));
  saveLocalCharges();
  cloudReady = true;
  render();
  setSyncStatus("Sincronizado con Firebase. Tus registros están guardados en la nube.");
}

async function saveChargeToCloud(charge) {
  const { id, ...data } = charge;
  await setDoc(doc(db, "users", currentUser.uid, "charges", String(id)), data);
}
async function deleteCharge(id) {
  if (!confirm("¿Querés eliminar esta carga del historial?")) return;
  if (!currentUser || !cloudReady) return showMessage("Esperá a que termine la sincronización.", "error");
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "charges", String(id)));
    charges = charges.filter(c => String(c.id) !== String(id));
    saveLocalCharges();
    render();
    setSyncStatus("Carga eliminada de la nube.");
  } catch (error) {
    console.error(error);
    showMessage(`No se pudo eliminar: ${friendlyError(error)}`, "error");
  }
}
function exportCSV() {
  const list = selectedCharges();
  if (!list.length) return alert("No hay cargas para exportar en el mes seleccionado.");
  const headers = ["Fecha", "Franja horaria", "kWh", "Costo UYU", "Precio UYU por kWh", "Porcentaje inicial", "Porcentaje final", "Odómetro km", "Notas"];
  const rows = list.map(c => [c.date, c.tariff, c.kwh, c.cost,
    Number(c.kwh) > 0 ? (c.cost / c.kwh).toFixed(2) : "0.00",
    c.startPercent, c.endPercent, c.odometer ?? "", c.notes ?? ""]);
  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mi-byd-cargas-${$("monthFilter").value}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function submitCharge(event) {
  event.preventDefault();
  if (!currentUser || !cloudReady || isSaving) return showMessage("Esperá a que la aplicación termine de sincronizar.", "error");
  updateEstimate();
  const date = $("date").value, tariff = $("tariff").value;
  const startPercent = Number($("startPercent").value), endPercent = Number($("endPercent").value);
  const kwh = Number($("kwh").value), cost = Number($("cost").value);
  const odometerRaw = $("odometer").value.trim();

  if (!date || $("startPercent").value === "" || $("endPercent").value === "" ||
      !Number.isFinite(startPercent) || !Number.isFinite(endPercent) ||
      startPercent < 0 || startPercent > 100 || endPercent < 0 ||
      endPercent > 100 || endPercent <= startPercent) {
    return showMessage("Ingresá una fecha válida y porcentajes correctos. El porcentaje final debe ser mayor que el inicial.", "error");
  }
  if (!Number.isFinite(kwh) || kwh <= 0 || !Number.isFinite(cost) || cost < 0) {
    return showMessage("No se pudo calcular la energía o el costo. Revisá el precio de referencia.", "error");
  }
  if (kwh > BATTERY_KWH * 1.5 &&
      !confirm("Ingresaste más de 67,68 kWh para una batería de 45,12 kWh. ¿Querés guardar igual?")) return;

  const odometer = odometerRaw === "" ? null : Number(odometerRaw);
  if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) {
    return showMessage("Revisá el valor del odómetro.", "error");
  }

  const charge = {
    id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    createdAt: Date.now(), date, tariff, startPercent, endPercent, kwh, cost,
    odometer, notes: $("notes").value.trim()
  };
  try {
    isSaving = true;
    setSyncStatus("Guardando carga en Firebase…");
    await saveChargeToCloud(charge);
    charges.push(charge);
    saveLocalCharges();
    $("monthFilter").value = date.slice(0, 7);
    $("chargeForm").reset();
    $("date").value = todayLocal();
    $("startPercent").value = "20";
    $("endPercent").value = "100";
    $("tariff").value = "Valle";
    updateEstimate();
    showMessage("Carga guardada correctamente en tu cuenta y en la nube.", "success");
    setSyncStatus("Sincronizado con Firebase.");
    render();
  } catch (error) {
    console.error(error);
    showMessage(`No se pudo guardar la carga: ${friendlyError(error)}`, "error");
    setSyncStatus("Error al sincronizar. Revisá conexión y reglas de Firestore.");
  } finally {
    isSaving = false;
  }
}

$("authForm").addEventListener("submit", loginEmail);
$("registerButton").addEventListener("click", registerEmail);
$("googleButton").addEventListener("click", loginGoogle);
$("logoutButton").addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (error) { console.error(error); setSyncStatus(friendlyError(error)); }
});
$("chargeForm").addEventListener("submit", submitCharge);
["startPercent", "endPercent", "referencePrice"].forEach(id => $(id).addEventListener("input", updateEstimate));
$("monthFilter").addEventListener("change", render);
$("exportButton").addEventListener("click", exportCSV);
$("resetButton").addEventListener("click", () => setTimeout(() => {
  $("date").value = todayLocal();
  $("startPercent").value = "20";
  $("endPercent").value = "100";
  $("tariff").value = "Valle";
  updateEstimate();
  showMessage("", "");
}, 0));

$("monthFilter").value = currentMonth();
$("date").value = todayLocal();
$("startPercent").value = "20";
$("endPercent").value = "100";
updateEstimate();

onAuthStateChanged(auth, async user => {
  currentUser = user;
  cloudReady = false;
  charges = [];
  showApp(user);
  if (!user) {
    setAuthMessage("");
    return;
  }
  try {
    await loadCloudAndMergeLocal();
  } catch (error) {
    console.error(error);
    setSyncStatus(`No se pudieron cargar tus registros: ${friendlyError(error)}`);
    showMessage("No se pudieron cargar las cargas. Verificá la configuración de Firebase.", "error");
  }
});

