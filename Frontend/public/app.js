const STORAGE_KEY = "igorsHttpClient.savedRequests.v1"; // Local storage key used to persist saved request definitions.

const fileInput = document.getElementById("fileInput"); // File input used for importing request JSON files.
const exportBtn = document.getElementById("exportBtn"); // Button used to export saved requests as JSON.
const clearBtn = document.getElementById("clearBtn"); // Button used to clear all locally stored requests.
const listElement = document.getElementById("list"); // Container that displays the list of saved requests.
const countElement = document.getElementById("count"); // Element that shows number of saved requests.

const specEditor = document.getElementById("specEditor"); // Text area/editor containing the selected request specification JSON.
const sendBtn = document.getElementById("sendBtn"); // Button used to send the current request spec to backend.
const statusElement = document.getElementById("status"); // Status line for user feedback and errors.
const responseElement = document.getElementById("response"); // Text area showing backend response payload.

let savedRequests = loadSavedRequests(); // Load previously saved requests from local storage on startup.
let selectedRequestIndex = savedRequests.length ? 0 : -1; // Select first request if present, otherwise mark no selection.

renderRequestList(); // Render saved request list immediately after load.
if (selectedRequestIndex >= 0) setSelectedRequest(selectedRequestIndex); // Populate editor with initially selected request.

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
  specEditor.value = ""; // Clear request editor content.
  responseElement.value = ""; // Clear response output content.
  statusElement.textContent = "Cleared."; // Inform user that data was cleared.

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

  specEditor.value = JSON.stringify(selectedRequest, null, 2); // Populate editor with selected request JSON.
  responseElement.value = ""; // Clear old response output when changing selection.
  statusElement.textContent = ""; // Clear status line when changing selection.
}

// Send request
sendBtn.addEventListener("click", async () => { // Handle user clicking Send.
  responseElement.value = ""; // Clear previous response output before sending.
  statusElement.textContent = "Sending..."; // Show sending status in UI.

  let requestSpec; // Hold parsed request spec from editor.
  try {
    requestSpec = JSON.parse(specEditor.value); // Parse editor JSON into request object.
  } catch (parseError) {
    statusElement.textContent = "Invalid JSON in editor."; // Report invalid JSON to user.
    responseElement.value = String(parseError); // Show parse error details in response panel.
    return; // Stop send flow when JSON is invalid.
  }

  // (Optional) Update the stored version of the selected request with edits
  // so clicking around doesn't lose changes.
  if (selectedRequestIndex >= 0) { // Update saved request when an item is currently selected.
    savedRequests[selectedRequestIndex] = normalizeSpec(requestSpec); // Normalize and store edited request.
    saveRequests(savedRequests); // Persist edited request list.
    renderRequestList(); // Refresh list in case name/method/url changed.
  }

  try {
    const apiResponse = await fetch("/api/send", { // Send request spec to backend relay endpoint.
      method: "POST", // Use POST because request spec is sent in body.
      headers: { "Content-Type": "application/json" }, // Tell backend payload is JSON.
      body: JSON.stringify(requestSpec) // Serialize request spec for transport.
    });

    const responsePayload = await apiResponse.json(); // Parse backend JSON response.

    if (responsePayload.error) { // Handle backend-reported error message.
      statusElement.textContent = `Error: ${responsePayload.error}`; // Show error in status line.
    } else {
      statusElement.textContent = `${responsePayload.status} ${responsePayload.statusText} • ${responsePayload.durationMs}ms`; // Show HTTP status and duration.
    }

    responseElement.value = JSON.stringify(responsePayload, null, 2); // Render full backend response in output panel.
  } catch (requestError) {
    statusElement.textContent = "Request failed."; // Show generic network/request failure.
    responseElement.value = String(requestError); // Show thrown error details in output panel.
  }
});

// Helpers
function normalizeSpec(requestSpec) {
  return {
    name: requestSpec?.name ?? "Unnamed Request", // Ensure request has a display name.
    url: requestSpec?.url ?? "", // Ensure request has URL field.
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