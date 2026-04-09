import express from "express"; // Import Express framework for building the API server.
import path from "path"; // Import path utilities for cross-platform file path handling.
import { fileURLToPath } from "url"; // Convert module file URL to a normal filesystem path.
import { setGlobalDispatcher, ProxyAgent } from "undici"; // Import Undici proxy support for outbound HTTP requests.
import rateLimit from "express-rate-limit";

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,        // 1 min
    limit: 20,                 // 20 requests for min
    standardHeaders: "draft-8", // modern RateLimit header
    legacyHeaders: false,      // disable X-RateLimit-*
    message: {
      error: "Too many requests. Slow down."
    }
  });

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY; // Read proxy from environment variables.
if (proxy) { // If a proxy is configured...
    setGlobalDispatcher(new ProxyAgent(proxy)); // Route all fetch calls through this proxy.
    console.log("Using proxy:", proxy); // Log the active proxy for visibility.
}

const __filename = fileURLToPath(import.meta.url); // Resolve current file path in ESM context.
const __dirname = path.dirname(__filename); // Resolve current directory path in ESM context.

const app = express(); // Create Express application instance.
app.use(express.json({ limit: "2mb" })); // Enable JSON body parsing with a 2 MB request body limit.

// Point to: IGORSHTTPCLIENT/Frontend/public
const frontendPublicDir = path.resolve(__dirname, "..", "Frontend", "public"); // Build absolute path to frontend static assets.
app.use(express.static(frontendPublicDir)); // Serve static frontend files from the public folder.

function buildUrl(url, queryParams = []) {
    const u = new URL(url); // Create URL object from base URL string.
    for (const p of queryParams) { // Iterate through query parameter entries.
        if (!p?.parameter_name) continue; // Skip invalid entries without a parameter name.
        u.searchParams.set(String(p.parameter_name), String(p.parameter_value ?? "")); // Add or overwrite query parameter value.
    }
    return u.toString(); // Return final URL as string.
}

function headersArrayToObject(headersArr = []) {
    const out = {}; // Prepare output object for request headers.
    for (const h of headersArr) { // Iterate through header entries from saved spec.
        if (!h?.header_name) continue; // Skip invalid header rows without a header name.

        // Ignore this "CORS" pseudo header if present in saved objects
        if (String(h.header_name).toLowerCase() === "cors") continue; // Do not forward non-standard pseudo header.

        out[String(h.header_name)] = String(h.header_value ?? ""); // Normalize and store header name/value pair.
    }
    return out; // Return final headers object.
}

// Optional safety (recommended): restrict which hosts can be called
const ALLOW_ANY = true; // Allow calling any host when true.
// const ALLOWED_HOSTS = new Set(["api.example.com"]);

async function assertAllowed(urlStr) {
    const u = new URL(urlStr);

    if (!["http:", "https:"].includes(u.protocol)) {
        throw new Error("Only http/https protocols are allowed");
    }

    if (await isPrivateHost(u.hostname)) {
        throw new Error("Access to private hosts is blocked");
    }
}

// Security improvement 1
import dns from "dns/promises";
import net from "net";

const PRIVATE_RANGES = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^169\.254\./,
    /^localhost$/i
];

async function isPrivateHost(hostname) {
    if (PRIVATE_RANGES.some(r => r.test(hostname))) return true;

    if (net.isIP(hostname)) {
        return PRIVATE_RANGES.some(r => r.test(hostname));
    }

    try {
        const records = await dns.lookup(hostname, { all: true });
        return records.some(r =>
            PRIVATE_RANGES.some(rx => rx.test(r.address))
        );
    } catch {
        return true; // fail closed
    }
}

app.post("/api/send", apiLimiter, async (req, res) => {
    try {
        const spec = req.body; // Read request specification from incoming JSON body.
        if (!spec?.url) return res.status(400).json({ error: "Missing url" }); // Validate required URL field.

        const finalUrl = buildUrl(spec.url, spec.query_parameters); // Build final URL with query parameters.
        await assertAllowed(finalUrl); // Enforce optional outbound host restrictions.

        const method = String(spec.method || "GET").toUpperCase(); // Resolve HTTP method with GET fallback.
        const headers = headersArrayToObject(spec.headers); // Convert header rows to fetch-compatible headers object.

        let body; // Declare request body payload for fetch.
        if (!["GET", "HEAD"].includes(method) && spec.body != null) { // Only send body for methods that support it.
            const contentTypeKey = Object.keys(headers).find(k => k.toLowerCase() === "content-type"); // Find content-type header key case-insensitively.
            const contentType = contentTypeKey ? headers[contentTypeKey] : ""; // Read content-type value if present.

            if (typeof spec.body === "string") { // Use body directly when user already provided text.
                body = spec.body; // Keep raw string body as-is.
            } else if (!contentType || contentType.includes("application/json")) { // Default object payloads to JSON.
                if (!contentType) headers["Content-Type"] = "application/json"; // Set JSON content-type when missing.
                body = JSON.stringify(spec.body); // Serialize object/array payload to JSON string.
            } else if (contentType.includes("application/x-www-form-urlencoded")) { // Encode body for HTML form submissions.
                body = new URLSearchParams(spec.body).toString(); // Convert object payload to form-urlencoded string.
            } else {
                body = JSON.stringify(spec.body); // Fallback serialization for unknown content-types.
            }
        }

        const started = Date.now(); // Capture request start timestamp.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const r = await fetch(finalUrl, {
            method,
            headers,
            body,
            signal: controller.signal
        });

        clearTimeout(timeout); // Execute outbound HTTP request.
        const durationMs = Date.now() - started; // Compute request duration in milliseconds.

        const text = await r.text(); // Read response body as text first.
        const responseHeaders = {}; // Prepare plain object for response headers.
        r.headers.forEach((v, k) => (responseHeaders[k] = v)); // Copy fetch Headers into serializable object.

        res.json({ // Return normalized response payload to frontend.
            ok: r.ok, // Indicate whether status code is in the success range.
            status: r.status, // Include numeric HTTP status code.
            statusText: r.statusText, // Include textual HTTP status message.
            url: r.url, // Include final URL after redirects.
            durationMs, // Include elapsed request time in milliseconds.
            headers: responseHeaders, // Include all response headers as key/value map.
            body: tryParseJson(text), // Parse JSON when possible, otherwise return raw text.
        });
    } catch (e) {
        console.error("FETCH ERROR:", e); // Log the top-level fetch error.
        console.error("CAUSE:", e?.cause); // Log low-level cause details when available.

        return res.status(500).json({
            error: e?.message || String(e), // Return error message to caller.
            name: e?.name, // Return error type/name to caller.
            cause: e?.cause // Return nested cause details when present.
                ? { message: e.cause.message, name: e.cause.name, code: e.cause.code }
                : undefined
        });
    }
});

function tryParseJson(text) {
    try { return JSON.parse(text); } catch { return text; } // Parse JSON safely and fall back to plain text.
}

// Make sure refresh on / works (optional but nice)
app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendPublicDir, "index.html")); // Serve SPA index for non-API routes.
});

app.listen(3000, () => console.log("Open http://localhost:3000")); // Start backend server on port 3000.

// Security improvements
