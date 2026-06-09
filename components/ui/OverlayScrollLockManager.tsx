"use client"

import { useEffect } from "react"

const OVERLAY_SELECTOR = '[data-pinetree-overlay="true"]'

export default function OverlayScrollLockManager() {
  useEffect(() => {
    const body = document.body
    let locked = false
    let scrollY = 0
    let previousStyles = {
      position: "",
      top: "",
      left: "",
      right: "",
      width: "",
      overflow: "",
      overflowX: ""
    }

    const lock = () => {
      if (locked) return
      locked = true
      scrollY = window.scrollY
      previousStyles = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
        overflowX: body.style.overflowX
      }

      body.classList.add("pinetree-modal-open")
      body.style.position = "fixed"
      body.style.top = `-${scrollY}px`
      body.style.left = "0"
      body.style.right = "0"
      body.style.width = "100%"
      body.style.overflow = "hidden"
      body.style.overflowX = "hidden"
    }

    const unlock = () => {
      if (!locked) return
      locked = false
      body.classList.remove("pinetree-modal-open")
      body.style.position = previousStyles.position || ""
      body.style.top = previousStyles.top || ""
      body.style.left = previousStyles.left || ""
      body.style.right = previousStyles.right || ""
      body.style.width = previousStyles.width || ""
      body.style.overflow = previousStyles.overflow || ""
      body.style.overflowX = previousStyles.overflowX || ""
      window.scrollTo(0, scrollY)
    }

    const sync = () => {
      const hasVisibleOverlay = Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR))
        .some((overlay) => overlay.getClientRects().length > 0)

      if (hasVisibleOverlay) {
        lock()
      } else {
        unlock()
      }
    }

    const observer = new MutationObserver(sync)
    observer.observe(body, { childList: true, subtree: true })
    window.addEventListener("resize", sync)
    sync()

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", sync)
      unlock()
    }
  }, [])

  return null
}
