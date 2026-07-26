export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload too large");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid json");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "invalid json");
  }
  return data;
}

export function checkOrigin(request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
