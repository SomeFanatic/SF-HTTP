const STORAGE_KEY = "igorsHttpClient.savedRequests.v1"; // Local storage key used to persist saved request definitions.
const fileInput = document.getElementById("fileInput"); // File input used for importing request JSON files.
const exportBtn = document.getElementById("exportBtn"); // Button used to export saved requests as JSON.
const clearBtn = document.getElementById("clearBtn"); // Button used to clear all locally stored requests.
const sendBtn = document.getElementById("sendBtn"); // Button used to send the current request spec to backend.
const templateBtn = document.getElementById("templateBtn");
const statusElement = document.getElementById("status"); // Status line for user feedback and errors.
const listElement = document.getElementById("list"); // Container that displays the list of saved requests.
const countElement = document.getElementById("count"); // Element that shows number of saved requests.
const specEditor = document.getElementById("specEditor"); // Text area/editor containing the selected request specification JSON.
const responseElement = document.getElementById("response"); // Text area showing backend response payload.
const templateModal = document.getElementById("templateModal");
const closeTemplate = document.getElementById("closeTemplate");
const templateViewer = document.getElementById("templateViewer");
const helpModal = document.getElementById("helpModal");

// ---- CodeMirror: Request editor ----
const specCodeMirror = CodeMirror.fromTextArea(
  document.getElementById("specEditor"),
  {
    mode: { name: "javascript", json: true },
    theme: "material-darker",
    lineNumbers: true,
    tabSize: 2,
    indentWithTabs: false,
    viewportMargin: Infinity // nech sa nerozbije výška
  }
);

// ---- CodeMirror: Response viewer ----
const responseCodeMirror = CodeMirror.fromTextArea(
  document.getElementById("response"),
  {
    mode: { name: "javascript", json: true },
    theme: "material-darker",
    lineNumbers: true,
    readOnly: true,
    viewportMargin: Infinity
  }
);




const REQUEST_TEMPLATE = {
  name: "Example request",
  url: "https://api.example.com/users",
  method: "GET",
  headers: [
    { key: "Authorization", value: "Bearer YOUR_TOKEN" }
  ],
  query_parameters: [
    { key: "limit", value: "10" }
  ],
  body: null
};

function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

function updateSendEnabled() {
  const text = specCodeMirror.getValue();
  const hasText = text.trim().length > 0;
  const valid = hasText && isValidJSON(text);
  sendBtn.disabled = isSending || !valid;
}

// --- Send button UI parts (spinner + label) ---
const sendLabel = sendBtn.querySelector(".label");
const sendSpinner = sendBtn.querySelector(".spinner");

let isSending = false;

function setSendLoading(loading) {
  isSending = loading;
  if (sendSpinner) sendSpinner.hidden = !loading;
  if (sendLabel) sendLabel.textContent = loading ? "Sending…" : "Send";
  // disabled stav riešime centrálne v updateSendEnabled()
  updateSendEnabled();
}

let savedRequests = loadSavedRequests(); // Load previously saved requests from local storage on startup.
let selectedRequestIndex = savedRequests.length ? 0 : -1; // Select first request if present, otherwise mark no selection.

renderRequestList(); // Render saved request list immediately after load.
if (selectedRequestIndex >= 0) setSelectedRequest(selectedRequestIndex); // Populate editor with initially selected request.
updateSendEnabled();

// Upload / import
fileInput.addEventListener("change", async (event) => { // Handle user selecting a file to import.
  const selectedFile = event.target.files?.[0]; // Read the first selected file from the input.
  if (!selectedFile) return; // Stop when no file was chosen.

  try {
    const fileText = await selectedFile.text(); // Read file contents as plain text.
    const parsedData = JSON.parse(fileText); // Parse imported text into JSON.

    if (!Array.isArray(parsedData)) { // Validate JSON root is an array of request objects.
      alert("The JSON must be an array: [{...},{...}]"); // Show validation error to user.
      return; // Stop import when format is invalid.
    }

    savedRequests = parsedData.map(normalizeSpec); // Normalize imported objects into expected request format.
    saveRequests(savedRequests); // Persist imported requests to local storage.

    selectedRequestIndex = savedRequests.length ? 0 : -1; // Select first imported request when available.
    renderRequestList(); // Re-render the sidebar list after import.
    if (selectedRequestIndex >= 0) setSelectedRequest(selectedRequestIndex); // Load selected request into editor.

    statusElement.textContent = `Imported ${savedRequests.length} requests into local storage.`; // Show successful import message.
  } catch (importError) {
    console.error(importError); // Log import failure details for debugging.
    alert("Failed to import. Check the JSON format."); // Show user-friendly import error.
  } finally {
    fileInput.value = ""; // Reset input so same file can be imported again.
  }
});

// Export
exportBtn.addEventListener("click", () => { // Handle exporting all saved requests to a file.
  const exportBlob = new Blob([JSON.stringify(savedRequests, null, 2)], { type: "application/json" }); // Build a downloadable JSON blob.
  const exportUrl = URL.createObjectURL(exportBlob); // Create temporary object URL for the blob.

  const downloadLink = document.createElement("a"); // Create a temporary anchor element for download.
  downloadLink.href = exportUrl; // Point anchor to generated blob URL.
  downloadLink.download = "requests.json"; // Set exported filename.
  downloadLink.click(); // Trigger browser download.

  URL.revokeObjectURL(exportUrl); // Release temporary URL to avoid memory leaks.
});


// Clear local
clearBtn.addEventListener("click", () => { // Handle clearing all saved requests.
  if (!confirm("Clear locally saved requests?")) return; // Ask user confirmation before destructive action.

  savedRequests = []; // Remove all saved requests from memory.
  selectedRequestIndex = -1; // Reset selected request to none.
  saveRequests(savedRequests); // Persist cleared state to local storage.

  listElement.innerHTML = ""; // Clear request list UI.
  countElement.textContent = "0 saved"; // Reset request count UI.
  specCodeMirror.setValue(""); // Clear request editor content.
  responseCodeMirror.setValue(""); // Clear response output content.
  statusElement.textContent = "Cleared."; // Inform user that data was cleared.
  updateSendEnabled();

  fileInput.value = ""; // Reset file input control.
});

// Selecting items
function renderRequestList() {
  listElement.innerHTML = ""; // Remove previous list items before re-rendering.
  countElement.textContent = `${savedRequests.length} saved`; // Show total saved request count.

  savedRequests.forEach((savedRequest, requestIndex) => { // Render one clickable row per saved request.
    const itemElement = document.createElement("div"); // Create list row element.
    itemElement.className = "item" + (requestIndex === selectedRequestIndex ? " active" : ""); // Mark currently selected row as active.
    itemElement.textContent = savedRequest.name || `(unnamed ${requestIndex + 1})`; // Show request name with fallback label.
    itemElement.title = `${(savedRequest.method || "GET").toUpperCase()} ${savedRequest.url || ""}`; // Show method and URL as hover tooltip.
    itemElement.addEventListener("click", () => setSelectedRequest(requestIndex)); // Select request when row is clicked.
    listElement.appendChild(itemElement); // Append row to list container.
  });
}

function setSelectedRequest(requestIndex) {
  selectedRequestIndex = requestIndex; // Update currently selected request index.

  [...listElement.children].forEach((childElement, childIndex) => { // Recompute active class for each row.
    childElement.classList.toggle("active", childIndex === requestIndex); // Keep active class only on selected row.
  });

  const selectedRequest = savedRequests[requestIndex]; // Read selected request object by index.
  if (!selectedRequest) return; // Stop if index is invalid or no request exists.

  specCodeMirror.setValue(
    JSON.stringify(selectedRequest, null, 2)
  ); // Populate editor with selected request JSON.
  responseCodeMirror.setValue(""); // Clear old response output when changing selection.
  statusElement.textContent = ""; // Clear status line when changing selection.
  updateSendEnabled();
}

// Send request
sendBtn.addEventListener("click", async (e) => {
  e.preventDefault();

  // okamžitá UX odozva
  statusElement.textContent = "Sending...";
  responseCodeMirror.setValue("");

  let requestSpec;
  try {
    requestSpec = JSON.parse(specCodeMirror.getValue());
  } catch (err) {
    statusElement.textContent = "Invalid JSON in editor.";
    responseCodeMirror.setValue(String(err));
    return;
  }

  setSendLoading(true);

  try {
    const apiResponse = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestSpec)
    });

    const responsePayload = await apiResponse.json();

    if (responsePayload.error) {
      statusElement.textContent = `Error: ${responsePayload.error}`;
    } else {
      statusElement.textContent =
        `${responsePayload.status} ${responsePayload.statusText} • ${responsePayload.durationMs}ms`;
    }

    responseCodeMirror.setValue(
      JSON.stringify(responsePayload, null, 2)
    );
  } catch (err) {
    statusElement.textContent = "Request failed.";
    responseCodeMirror.setValue(String(err));
  } finally {
    setSendLoading(false);
  }
});


// Helpers
function normalizeSpec(requestSpec) {
  return {
    name: requestSpec?.name ?? "Unnamed Request", // Ensure request has a display name.
    url: requestSpec?.url ?? requestSpec?.endpoint ?? "", // Ensure request has URL field.
    method: (requestSpec?.method ?? "GET").toUpperCase(), // Ensure method exists and is uppercase.
    headers: Array.isArray(requestSpec?.headers) ? requestSpec.headers : [], // Ensure headers is always an array.
    query_parameters: Array.isArray(requestSpec?.query_parameters) ? requestSpec.query_parameters : [], // Ensure query parameters is always an array.
    body: requestSpec?.body ?? null // Ensure body exists (or explicit null).
  };
}

function loadSavedRequests() {
  try {
    const rawSavedRequests = localStorage.getItem(STORAGE_KEY); // Read saved requests string from local storage.
    return rawSavedRequests ? JSON.parse(rawSavedRequests) : []; // Parse saved requests or return empty list.
  } catch {
    return []; // Return empty list when local storage data is invalid.
  }
}

function saveRequests(requests) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requests)); // Persist request list to local storage.
}

// ===============================
// UX LOGIC (Theme only)
// ===============================
function syncThemeButtonLabel() {
  const btn = document.querySelector(".theme-toggle");
  if (!btn) return;
  btn.lastChild.textContent =
    document.body.dataset.theme === "dark" ? " Dark" : " Light";
}

const savedTheme = localStorage.getItem("theme");
document.body.dataset.theme = (savedTheme === "light" || savedTheme === "dark") ? savedTheme : "dark";
syncThemeButtonLabel();

function toggleTheme() {
  const theme = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  syncThemeButtonLabel();
}


// React to editor changes
specCodeMirror.on("change", () => {
  updateSendEnabled();
});

// Open template modal
templateBtn.addEventListener("click", () => {
  templateViewer.value = JSON.stringify(REQUEST_TEMPLATE, null, 2);
  templateModal.hidden = false;
});

// Close template modal
closeTemplate.addEventListener("click", (e) => {
  e.stopPropagation();
  templateModal.hidden = true;
});

// Click outside to close
templateModal.addEventListener("click", (e) => {
  if (e.target === templateModal) {
    templateModal.hidden = true;
  }
});

document.getElementById("helpBtn").addEventListener("click", () => {
  helpModal.hidden = false;
});

document.getElementById("closeHelp").addEventListener("click", () => {
  helpModal.hidden = true;
});

helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) helpModal.hidden = true;
});

const copyResponseBtn = document.getElementById("copyResponseBtn");
const copyFeedback = document.getElementById("copyFeedback");

copyResponseBtn.addEventListener("click", async () => {
  const text = responseCodeMirror.getValue();

  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);

    copyFeedback.hidden = false;

    // znova skryť po animácii
    setTimeout(() => {
      copyFeedback.hidden = true;
    }, 1400);
  } catch (err) {
    console.error("Copy failed", err);
  }
});
