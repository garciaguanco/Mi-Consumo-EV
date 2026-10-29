const STORAGE_KEY = "miBydCargas_v1";
const BATTERY_KWH = 45.12;
const WLTP_KM = 312;

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat("es-UY", {
  style: "currency", currency: "UYU", minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(value) || 0).replace("UYU", "$U");
const decimal = (value) => new Intl.NumberFormat("es-UY", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(value) || 0);

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function currentMonth() { return todayLocal().slice(0, 7); }

let charges = loadCharges();

function loadCharges() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    console.error("No se pudieron leer las cargas guardadas.", error);
    return [];
  }
}
function saveCharges() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(charges));
}
function selectedCharges() {
  const month = $("monthFilter").value;
  return charges.filter(charge => charge.date.slice(0, 7) === month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
function render() {
  const list = selectedCharges();
  const totalCost = list.reduce((sum, charge) => sum + charge.cost, 0);
  const totalKwh = list.reduce((sum, charge) => sum + charge.kwh, 0);
  $("monthlyCost").textContent = money(totalCost);
  $("monthlyKwh").textContent = `${decimal(totalKwh)} kWh`;
  $("monthlyCount").textContent = `${list.length} ${list.length === 1 ? "carga registrada" : "cargas registradas"}`;
  $("averageKwh").textContent = totalKwh > 0 ? money(totalCost / totalKwh) : money(0);
  $("costPerKm").textContent = money(BATTERY_KWH * Number($("referencePrice").value || 0) / WLTP_KM);
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
    const values = [
      charge.date,
      charge.tariff,
      `${decimal(charge.kwh)} kWh`,
      money(charge.cost),
      money(charge.cost / charge.kwh),
      charge.odometer ? `${new Intl.NumberFormat("es-UY").format(charge.odometer)} km` : "—"
    ];
    values.forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "Eliminar";
    deleteButton.setAttribute("aria-label", `Eliminar carga del ${charge.date}`);
    deleteButton.addEventListener("click", () => deleteCharge(charge.id));
    actionCell.appendChild(deleteButton);
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}
function updateEstimate() {
  const price = Math.max(0, Number($("referencePrice").value) || 0);
  $("fullChargeEstimate").textContent = money(BATTERY_KWH * price);
  $("estimatedKmCost").textContent = money(BATTERY_KWH * price / WLTP_KM);
  const kwh = Math.max(0, Number($("kwh").value) || 0);
  const cost = Math.max(0, Number($("cost").value) || 0);
  $("pricePreview").textContent = kwh > 0
    ? `Precio calculado: ${money(cost / kwh)} por kWh`
    : "Ingresá los kWh para calcular el precio por kWh.";
}
function showMessage(message, type) {
  const el = $("formMessage");
  el.textContent = message;
  el.className = `form-message ${type || ""}`;
}
function deleteCharge(id) {
  if (!confirm("¿Querés eliminar esta carga del historial?")) return;
  charges = charges.filter(charge => charge.id !== id);
  saveCharges();
  render();
}
function exportCSV() {
  const list = selectedCharges();
  if (!list.length) {
    alert("No hay cargas para exportar en el mes seleccionado.");
    return;
  }
  const headers = ["Fecha", "Franja horaria", "kWh", "Costo UYU", "Precio UYU por kWh", "Porcentaje inicial", "Porcentaje final", "Odómetro km", "Notas"];
  const rows = list.map(c => [c.date, c.tariff, c.kwh, c.cost, (c.cost / c.kwh).toFixed(2), c.startPercent, c.endPercent, c.odometer ?? "", c.notes ?? ""]);
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mi-byd-cargas-${$("monthFilter").value}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

$("chargeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const date = $("date").value;
  const tariff = $("tariff").value;
  const startPercent = Number($("startPercent").value);
  const endPercent = Number($("endPercent").value);
  const kwh = Number($("kwh").value);
  const cost = Number($("cost").value);
  const odometerRaw = $("odometer").value.trim();

  if (!date || !Number.isFinite(kwh) || kwh <= 0 || !Number.isFinite(cost) || cost < 0) {
    showMessage("Revisá la fecha, los kWh y el costo ingresado.", "error");
    return;
  }
  if (startPercent < 0 || startPercent > 100 || endPercent < 0 || endPercent > 100 || endPercent < startPercent) {
    showMessage("Los porcentajes deben estar entre 0 y 100, y el final no puede ser menor que el inicial.", "error");
    return;
  }
  if (kwh > BATTERY_KWH * 1.5) {
    const proceed = confirm("Ingresaste más de 67,68 kWh para una batería de 45,12 kWh. ¿Querés guardar igual?");
    if (!proceed) return;
  }

  charges.push({
    id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    createdAt: Date.now(),
    date, tariff, startPercent, endPercent, kwh, cost,
    odometer: odometerRaw === "" ? null : Number(odometerRaw),
    notes: $("notes").value.trim()
  });
  saveCharges();
  $("monthFilter").value = date.slice(0, 7);
  $("chargeForm").reset();
  $("date").value = todayLocal();
  $("startPercent").value = "20";
  $("endPercent").value = "100";
  $("tariff").value = "Valle";
  showMessage("Carga guardada correctamente en este navegador.", "success");
  render();
});

$("monthFilter").addEventListener("change", render);
$("referencePrice").addEventListener("input", render);
["kwh", "cost"].forEach(id => $(id).addEventListener("input", updateEstimate));
$("exportButton").addEventListener("click", exportCSV);
$("resetButton").addEventListener("click", () => {
  setTimeout(() => {
    $("date").value = todayLocal();
    $("startPercent").value = "20";
    $("endPercent").value = "100";
    $("tariff").value = "Valle";
    updateEstimate();
    showMessage("", "");
  }, 0);
});

$("monthFilter").value = currentMonth();
$("date").value = todayLocal();
render();
