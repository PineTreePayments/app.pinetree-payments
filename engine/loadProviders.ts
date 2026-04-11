let providersLoaded = false

export async function loadProviders() {
  if (providersLoaded) return

  await import("../providers")
  providersLoaded = true
}