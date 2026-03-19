"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { Toaster } from "sonner"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()

  const [userEmail, setUserEmail] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  /* -----------------------------
  SESSION CHECK
  ----------------------------- */

  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getSession()

      if (!data.session) {
        router.replace("/login")
        return
      }

      setUserEmail(data.session.user.email ?? "")
    }

    checkSession()
  }, [router])

  /* -----------------------------
  CLOSE MENUS ON ROUTE CHANGE
  ----------------------------- */

  useEffect(() => {
    setMenuOpen(false)
    setSidebarOpen(false)
  }, [pathname])

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
    { name: "Transactions", href: "/dashboard/transactions" },
    { name: "Reports", href: "/dashboard/reports" },
    { name: "Wallets", href: "/dashboard/wallets" },
    { name: "Providers", href: "/dashboard/providers" },
    { name: "Settings", href: "/dashboard/settings" },
  ]

  return (
    <div className="relative min-h-screen bg-gray-100">
      {/* MOBILE OVERLAY */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex min-h-screen">
        {/* SIDEBAR */}
        <aside
          className={`
            fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200
            transform transition-transform duration-300 ease-in-out
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            lg:translate-x-0 lg:static lg:flex lg:flex-col
            min-h-screen
          `}
        >
          <div className="px-6 py-7 border-b border-gray-100">
            <h1 className="text-2xl font-semibold text-gray-900">
              PineTree
            </h1>
          </div>

          <nav className="flex-1 px-4 py-5 space-y-2 overflow-y-auto">
            {nav.map((item) => {
              const active = pathname === item.href

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`block rounded-xl px-4 py-3 text-base lg:text-sm font-medium transition ${
                    active
                      ? "bg-blue-50 text-blue-600"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                >
                  {item.name}
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* MAIN */}
        <div className="flex min-w-0 flex-1 flex-col lg:ml-0">
          {/* TOP BAR */}
          <header className="sticky top-0 z-20 h-16 bg-blue-600 flex items-center justify-between px-4 lg:px-8 shadow-sm relative">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-gray-800 shadow-sm"
                aria-label="Open menu"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M4 7H20"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M4 12H20"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M4 17H20"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="relative">
              <button
                onClick={() => setMenuOpen((prev) => !prev)}
                className="text-sm font-medium text-white cursor-pointer hover:opacity-80"
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
          <main className="flex-1 p-4 sm:p-6 lg:p-10 overflow-x-hidden">
            <div className="mx-auto w-full max-w-6xl">
              {children}
            </div>
          </main>

          <Toaster position="top-right" richColors closeButton />
        </div>
      </div>
    </div>
  )
}