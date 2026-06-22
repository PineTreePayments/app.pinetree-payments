"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { Toaster } from "sonner"
import PineTreeDynamicProvider from "@/components/providers/PineTreeDynamicProvider"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()

  const [userEmail, setUserEmail] = useState("")
  const [isAdmin, setIsAdmin] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

  /* -----------------------------
  SESSION CHECK
  ----------------------------- */

  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getSession()

      console.info("[auth:dashboard] session check", {
        pathname,
        hasSession: Boolean(data.session),
        userId: data.session?.user?.id || null,
        email: data.session?.user?.email || null,
        cookieNames: document.cookie
          .split(";")
          .map((cookie) => cookie.trim().split("=")[0])
          .filter((name) => name.startsWith("sb-") || name.includes("auth"))
      })

      if (!data.session) {
        router.replace("/login")
        return
      }

      setUserEmail(data.session.user.email ?? "")

      try {
        const meRes = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        })
        if (meRes.ok) {
          const meData = await meRes.json()
          setIsAdmin(meData.isAdmin === true)
        }
      } catch {
        // non-critical: sidebar admin item stays hidden
      }
    }

    checkSession()
  }, [pathname, router])

  /* -----------------------------
  CLOSE MENUS ON ROUTE CHANGE
  ----------------------------- */

  useEffect(() => {
    queueMicrotask(() => {
      setMenuOpen(false)
      setSidebarOpen(false)
    })
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (accountMenuRef.current?.contains(target)) return
      setMenuOpen(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [menuOpen])

  /* -----------------------------
  LOGOUT
  ----------------------------- */

  async function logout() {
    await supabase.auth.signOut()
    router.replace("/login")
  }

  /* -----------------------------
  NAV
  ----------------------------- */

  const nav = [
    { name: "Overview", href: "/dashboard" },
    { name: "POS", href: "/dashboard/pos" },
    { name: "Online Checkout", href: "/dashboard/checkout" },
    { name: "Transactions", href: "/dashboard/transactions" },
    { name: "Reports", href: "/dashboard/reports" },
    { name: "Wallets", href: "/dashboard/wallets" },
    { name: "Wallet Setup", href: "/dashboard/wallet-setup" },
    { name: "Inventory", href: "/dashboard/inventory" },
    { name: "Providers", href: "/dashboard/providers" },
    { name: "Help Center", href: "/dashboard/help" },
    { name: "Developer", href: "/dashboard/developer" },
    { name: "Settings", href: "/dashboard/settings" },
    ...(isAdmin ? [{ name: "Admin", href: "/dashboard/admin" }] : []),
  ]

  return (
    <PineTreeDynamicProvider>
    <div className="relative min-h-screen bg-gray-100">
      {/* MOBILE OVERLAY */}
      {sidebarOpen && (
        <div
          data-pinetree-overlay="true"
          className="pinetree-modal-backdrop fixed inset-0 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex min-h-screen">
        {/* SIDEBAR */}
        <aside
          className={`
            fixed inset-y-0 left-0 z-40 flex h-[100dvh] max-h-[100dvh] w-64 flex-col overflow-hidden bg-white border-r border-gray-200
            transform transition-transform duration-300 ease-in-out
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            lg:translate-x-0
            pt-[env(safe-area-inset-top)]
          `}
        >
          <div className="shrink-0 border-b border-gray-100 px-6 py-5">
            <Link
              href="/dashboard"
              aria-label="PineTree Payments"
              onClick={() => setSidebarOpen(false)}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/80 transition hover:bg-gray-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
            >
              <Image
                src="/favicon.ico"
                alt=""
                aria-hidden="true"
                className="h-9 w-9 object-contain"
                width={36}
                height={36}
              />
            </Link>
          </div>

          <nav className="pinetree-sidebar-nav min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {nav.map((item) => {
              const active = pathname === item.href

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`block min-w-0 max-w-full rounded-xl px-4 py-3 text-base font-medium outline-none transition focus-visible:ring-4 focus-visible:ring-blue-100 lg:text-sm ${
                    active
                      ? "bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgba(0,82,255,0.08)]"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:bg-blue-50/70 focus-visible:text-blue-700"
                  }`}
                >
                  <span className="block min-w-0 truncate">{item.name}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* MAIN */}
        <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
          {/* TOP BAR */}
          <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between bg-blue-600 px-3 pt-[env(safe-area-inset-top)] shadow-sm sm:px-4 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/95 shadow-sm ring-1 ring-white/40 transition hover:bg-white focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30 lg:hidden"
                aria-label="PineTree Payments"
              >
                <Image
                  src="/favicon.ico"
                  alt=""
                  aria-hidden="true"
                  className="h-7 w-7 object-contain"
                  width={28}
                  height={28}
                />
              </button>
            </div>

            <div ref={accountMenuRef} className="relative">
              <button
                onClick={() => setMenuOpen((prev) => !prev)}
                className="inline-flex min-h-10 items-center rounded-xl px-2 text-sm font-medium text-white hover:bg-white/10"
              >
                Account
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-12 w-56 bg-white border border-gray-200 rounded-xl shadow-lg p-3">
                  <div className="text-xs text-gray-500 mb-2">
                    Signed in as
                  </div>

                  <div className="text-sm font-medium text-gray-900 mb-3 break-all">
                    {userEmail}
                  </div>

                  <button
                    onClick={logout}
                    className="w-full text-left text-sm text-red-600 hover:bg-gray-100 rounded-lg px-3 py-2"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </header>

          {/* PAGE CONTENT */}
          <main className="flex-1 overflow-x-hidden px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pt-6 lg:p-10">
            <div className="mx-auto w-full max-w-6xl">
              {children}
            </div>
          </main>

          <Toaster position="top-right" richColors closeButton />
        </div>
      </div>
    </div>
    </PineTreeDynamicProvider>
  )
}
