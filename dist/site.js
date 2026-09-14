const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("[data-navigation]");
const form = document.querySelector("#pledge-form");
const dialog = document.querySelector("#pledge-dialog");
const summary = document.querySelector("[data-pledge-summary]");
const referenceTarget = document.querySelector("[data-pledge-reference]");
const copyStatus = document.querySelector("[data-copy-status]");
const cashFields = document.querySelector("[data-cash-fields]");
const formStepLabel = document.querySelector(".form-step");
const formError = document.querySelector("[data-form-error]");
const stepProgress = document.querySelector("[data-step-progress]");
const stepTitle = document.querySelector("[data-step-title]");
const floatingCta = document.querySelector("[data-floating-cta]");
let lastSummaryText = "";

const updateHeader = () => {
  const requiresSolidHeader = document.body.classList.contains("pledge-page-body");
  header?.classList.toggle("scrolled", requiresSolidHeader || window.scrollY > 24);
  floatingCta?.classList.toggle("visible", window.scrollY > 520);
};

const closeMenu = () => {
  navigation?.classList.remove("open");
  header?.classList.remove("menu-open");
  menuToggle?.setAttribute("aria-expanded", "false");
};

menuToggle?.addEventListener("click", () => {
  const nextOpen = !navigation?.classList.contains("open");
  navigation?.classList.toggle("open", nextOpen);
  header?.classList.toggle("menu-open", nextOpen);
  menuToggle.setAttribute("aria-expanded", String(nextOpen));
});

navigation?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

const yearTarget = document.querySelector("[data-year]");
if (yearTarget) yearTarget.textContent = new Date().getFullYear();

const setStep = (step) => {
  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    const active = Number(panel.dataset.stepPanel) === step;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  formStepLabel.textContent = `0${step} / 02`;
  stepProgress?.classList.toggle("complete", step === 2);
  if (stepTitle) {
    stepTitle.textContent = step === 1 ? "Define your contribution" : "Confirm donor details";
  }
  formError.textContent = "";

  if (step === 2) {
    form.querySelector('[name="fullName"]').focus();
  } else {
    form.querySelector('input[name="contributionType"]:checked')?.focus();
  }
};

const selectedValue = (name) =>
  form.querySelector(`input[name="${name}"]:checked`)?.value ||
  form.querySelector(`[name="${name}"]`)?.value ||
  "";

const updateContributionFields = () => {
  const isCash = selectedValue("contributionType") === "Cash gift";
  cashFields.hidden = !isCash;
  form.querySelector('[name="amount"]').required = isCash;
};

form.querySelectorAll('input[name="contributionType"]').forEach((input) => {
  input.addEventListener("change", updateContributionFields);
});
updateContributionFields();

const amountInput = form.querySelector('[name="amount"]');
const currencyInput = form.querySelector('[name="currency"]');
const amountPresets = [...form.querySelectorAll("[data-amount]")];
const presetValues = {
  NGN: [
    ["100000", "₦100k"],
    ["500000", "₦500k"],
    ["1000000", "₦1m"],
    ["5000000", "₦5m"],
  ],
  USD: [
    ["100", "$100"],
    ["500", "$500"],
    ["1000", "$1k"],
    ["5000", "$5k"],
  ],
};

const syncPresetState = () => {
  amountPresets.forEach((button) => {
    button.classList.toggle("selected", button.dataset.amount === amountInput?.value);
  });
};

const updatePresetCurrency = () => {
  const values = presetValues[currencyInput?.value] || presetValues.NGN;
  amountPresets.forEach((button, index) => {
    const [amount, label] = values[index];
    button.dataset.amount = amount;
    button.textContent = label;
  });
  syncPresetState();
};

amountPresets.forEach((button) => {
  button.addEventListener("click", () => {
    amountInput.value = button.dataset.amount;
    syncPresetState();
    amountInput.focus();
  });
});

currencyInput?.addEventListener("change", updatePresetCurrency);
amountInput?.addEventListener("input", syncPresetState);
updatePresetCurrency();

form.querySelector("[data-next-step]")?.addEventListener("click", () => {
  const type = selectedValue("contributionType");
  const amount = form.querySelector('[name="amount"]');

  if (type === "Cash gift" && (!amount.value || Number(amount.value) <= 0)) {
    amount.setCustomValidity("Enter an indicative amount.");
    amount.reportValidity();
    amount.setCustomValidity("");
    return;
  }

  setStep(2);
});

form.querySelector("[data-previous-step]")?.addEventListener("click", () => setStep(1));

const formatAmount = (data) => {
  if (data.contributionType !== "Cash gift") return "To be assessed";
  const numericAmount = Number(data.amount);
  if (!Number.isFinite(numericAmount)) return "Not specified";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: data.currency,
    maximumFractionDigits: 0,
  }).format(numericAmount);
};

const makeReference = () => {
  const date = new Date();
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `IBMC-${stamp}-${random}`;
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  formError.textContent = "";

  if (!form.checkValidity()) {
    formError.textContent = "Please complete the required contact and consent fields.";
    form.reportValidity();
    return;
  }

  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  const reference = makeReference();
  const fields = [
    ["Donor", data.fullName],
    ["Email", data.email],
    ["Contribution", data.contributionType],
    ["Indicative value", formatAmount(data)],
    ["Frequency", data.contributionType === "Cash gift" ? data.frequency : "To be agreed"],
    ["Recognition", data.recognition],
    ["Note", data.note || "None provided"],
  ];

  summary.replaceChildren(
    ...fields.map(([label, value]) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      row.append(term, detail);
      return row;
    }),
  );

  referenceTarget.textContent = reference;
  lastSummaryText = [
    "IBMC Endowment Fund — Pledge Brief",
    `Reference: ${reference}`,
    ...fields.map(([label, value]) => `${label}: ${value}`),
    "",
    "Private preview only. No funds have been collected and nothing has been submitted.",
  ].join("\n");

  copyStatus.textContent = "";
  document.body.classList.add("dialog-open");
  dialog.showModal();
});

const closeDialog = () => {
  dialog.close();
  document.body.classList.remove("dialog-open");
};

document.querySelectorAll("[data-dialog-close]").forEach((button) => {
  button.addEventListener("click", closeDialog);
});

dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) closeDialog();
});

dialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));

document.querySelector("[data-copy-pledge]")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastSummaryText);
    copyStatus.textContent = "Pledge summary copied.";
  } catch {
    copyStatus.textContent = "Copy was unavailable. Select the summary text manually.";
  }
});
