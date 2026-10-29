
const STORAGE_KEY = "miBydCargas_v1";
const BATTERY_KWH = 45.12;
const WLTP_KM = 312;
const IVA_FACTOR = 1.22;

const $ = (id) => document.getElementById(id);

const money = (value) =>
  new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: "UYU",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
    .format(Number(value) || 0)
    .replace("UYU", "$U");

const decimal = (value) =>
  new Intl.NumberFormat("es-UY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);

function todayLocal() {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function currentMonth() {
  return todayLocal().slice(0, 7);
}

let charges = loadCharges();

function loadCharges() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]"
    );

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

  return charges
    .filter(charge => charge.date.slice(0, 7) === month)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt - a.createdAt
    );
}

function render() {
  const list = selectedCharges();

  const totalCost = list.reduce(
    (sum, charge) => sum + Number(charge.cost || 0),
    0
  );

  const totalKwh = list.reduce(
    (sum, charge) => sum + Number(charge.kwh || 0),
    0
  );

  $("monthlyCost").textContent = money(totalCost);
  $("monthlyKwh").textContent = `${decimal(totalKwh)} kWh`;

  $("monthlyCount").textContent =
    `${list.length} ${list.length === 1 ? "carga registrada" : "cargas registradas"}`;

  $("averageKwh").textContent =
    totalKwh > 0 ? money(totalCost / totalKwh) : money(0);

  const referencePrice = Math.max(
    0,
    Number($("referencePrice").value) || 0
  );

  $("costPerKm").textContent = money(
    BATTERY_KWH * referencePrice / WLTP_KM
  );

  renderHistory(list);
  updateEstimate();
}

function renderHistory(list) {
  const body = $("historyBody");

  if (!list.length) {
    body.innerHTML =
      '<tr><td colspan="7" class="empty-state">Todavía no hay cargas registradas para este mes.</td></tr>';
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
      Number(charge.kwh) > 0
        ? money(charge.cost / charge.kwh)
        : money(0),
      charge.odometer
        ? `${new Intl.NumberFormat("es-UY").format(charge.odometer)} km`
        : "—"
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
    deleteButton.setAttribute(
      "aria-label",
      `Eliminar carga del ${charge.date}`
    );

    deleteButton.addEventListener("click", () => {
      deleteCharge(charge.id);
    });

    actionCell.appendChild(deleteButton);
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}

/*
 * Calcula automáticamente la energía y el costo
 * a partir del porcentaje inicial y final de batería.
 */
function updateEstimate() {
  const price = Math.max(
    0,
    Number($("referencePrice").value) || 0
  );

  const fullCharge = BATTERY_KWH * price;

  $("fullChargeEstimate").textContent = money(fullCharge);

  // Segundo renglón: importe de referencia multiplicado por 1,22.
  $("fullChargeWithIva").textContent = money(
    fullCharge * IVA_FACTOR
  );

  $("estimatedKmCost").textContent = money(
    fullCharge / WLTP_KM
  );

  const startRaw = $("startPercent").value;
  const endRaw = $("endPercent").value;

  if (startRaw === "" || endRaw === "") {
    $("kwh").value = "";
    $("cost").value = "";
    $("pricePreview").textContent =
      "Ingresá el porcentaje inicial y final para calcular la carga.";
    return;
  }

  const start = Number(startRaw);
  const end = Number(endRaw);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start > 100 ||
    end < 0 ||
    end > 100 ||
    end < start
  ) {
    $("kwh").value = "";
    $("cost").value = "";
    $("pricePreview").textContent =
      "Revisá los porcentajes: deben estar entre 0 y 100 y el final no puede ser menor que el inicial.";
    return;
  }

  const difference = end - start;
  const energy = BATTERY_KWH * difference / 100;
  const totalCost = energy * price;

  $("kwh").value = energy.toFixed(2);
  $("cost").value = totalCost.toFixed(2);

  $("pricePreview").textContent =
    `Energía estimada: ${decimal(energy)} kWh · Costo estimado: ${money(totalCost)}`;
}

function showMessage(message, type) {
  const el = $("formMessage");

  el.textContent = message;
  el.className = `form-message ${type || ""}`;
}

function deleteCharge(id) {
  if (!confirm("¿Querés eliminar esta carga del historial?")) {
    return;
  }

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

  const headers = [
    "Fecha",
    "Franja horaria",
    "kWh",
    "Costo UYU",
    "Precio UYU por kWh",
    "Porcentaje inicial",
    "Porcentaje final",
    "Odómetro km",
    "Notas"
  ];

  const rows = list.map(charge => [
    charge.date,
    charge.tariff,
    charge.kwh,
    charge.cost,
    Number(charge.kwh) > 0
      ? (charge.cost / charge.kwh).toFixed(2)
      : "0.00",
    charge.startPercent,
    charge.endPercent,
    charge.odometer ?? "",
    charge.notes ?? ""
  ]);

  const csv = [headers, ...rows]
    .map(row =>
      row
        .map(value => `"${String(value).replaceAll('"', '""')}"`)
        .join(";")
    )
    .join("\r\n");

  const blob = new Blob(
    ["\uFEFF" + csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `mi-byd-cargas-${$("monthFilter").value}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

$("chargeForm").addEventListener("submit", (event) => {
  event.preventDefault();

  updateEstimate();

  const date = $("date").value;
  const tariff = $("tariff").value;
  const startPercent = Number($("startPercent").value);
  const endPercent = Number($("endPercent").value);
  const kwh = Number($("kwh").value);
  const cost = Number($("cost").value);
  const odometerRaw = $("odometer").value.trim();

  if (
    !date ||
    $("startPercent").value === "" ||
    $("endPercent").value === "" ||
    !Number.isFinite(startPercent) ||
    !Number.isFinite(endPercent) ||
    startPercent < 0 ||
    startPercent > 100 ||
    endPercent < 0 ||
    endPercent > 100 ||
    endPercent <= startPercent
  ) {
    showMessage(
      "Ingresá una fecha válida y porcentajes correctos. El porcentaje final debe ser mayor que el inicial.",
      "error"
    );
    return;
  }

  if (
    !Number.isFinite(kwh) ||
    kwh <= 0 ||
    !Number.isFinite(cost) ||
    cost < 0
  ) {
    showMessage(
      "No se pudo calcular la energía o el costo. Revisá el precio de referencia.",
      "error"
    );
    return;
  }

  if (kwh > BATTERY_KWH * 1.5) {
    const proceed = confirm(
      "Ingresaste más de 67,68 kWh para una batería de 45,12 kWh. ¿Querés guardar igual?"
    );

    if (!proceed) return;
  }

  const odometer = odometerRaw === ""
    ? null
    : Number(odometerRaw);

  if (
    odometer !== null &&
    (!Number.isFinite(odometer) || odometer < 0)
  ) {
    showMessage("Revisá el valor del odómetro.", "error");
    return;
  }

  charges.push({
    id: (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    createdAt: Date.now(),
    date,
    tariff,
    startPercent,
    endPercent,
    kwh,
    cost,
    odometer,
    notes: $("notes").value.trim()
  });

  saveCharges();

  $("monthFilter").value = date.slice(0, 7);

  $("chargeForm").reset();

  $("date").value = todayLocal();
  $("startPercent").value = "20";
  $("endPercent").value = "100";
  $("tariff").value = "Valle";

  updateEstimate();

  showMessage(
    "Carga guardada correctamente en este navegador.",
    "success"
  );

  render();
});

// Actualizar los cálculos al cambiar los porcentajes o el precio.
["startPercent", "endPercent", "referencePrice"].forEach(id => {
  $(id).addEventListener("input", updateEstimate);
});

$("monthFilter").addEventListener("change", render);
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

// Inicializar la aplicación.
$("monthFilter").value = currentMonth();
$("date").value = todayLocal();
$("startPercent").value = "20";
$("endPercent").value = "100";

updateEstimate();
render();

