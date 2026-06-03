function publicEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || "").trim()
    if (value) return value
  }
  return ""
}

export const albyHubUrl =
  publicEnv("NEXT_PUBLIC_ALBY_HUB_URL", "NEXT_PUBLIC_ALBY_HUB_APPS_URL") ||
  "https://getalby.com/hub/apps"

export const zeusIosUrl =
  publicEnv("NEXT_PUBLIC_ZEUS_IOS_URL") ||
  "https://apps.apple.com/us/app/zeus-ln/id1456038895"

export const zeusAndroidUrl =
  publicEnv("NEXT_PUBLIC_ZEUS_ANDROID_URL") ||
  "https://play.google.com/store/apps/details?id=app.zeusln"

export const albyGuideUrl =
  publicEnv("NEXT_PUBLIC_ALBY_NWC_GUIDE_URL", "NEXT_PUBLIC_ALBY_NWC_DOCS_URL") ||
  "https://guides.getalby.com/user-guide/alby-account-and-browser-extension/alby-hub/nwc"

export const zeusGuideUrl =
  publicEnv("NEXT_PUBLIC_ZEUS_NWC_GUIDE_URL", "NEXT_PUBLIC_ZEUS_DOCS_URL") ||
  "https://zeusln.app"

export const nwcGuideUrl =
  publicEnv("NEXT_PUBLIC_NWC_GUIDE_URL", "NEXT_PUBLIC_ALBY_NWC_GUIDE_URL", "NEXT_PUBLIC_ALBY_NWC_DOCS_URL") ||
  albyGuideUrl
