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

  const [userEmail,setUserEmail] = useState("")
  const [menuOpen,setMenuOpen] = useState(false)
  const [sidebarOpen,setSidebarOpen] = useState(false)

  /* -----------------------------
  SESSION CHECK
  ----------------------------- */

  useEffect(()=>{

    async function checkSession(){

      const { data } = await supabase.auth.getSession()

      if(!data.session){
        router.replace("/login")
        return
      }

      setUserEmail(data.session.user.email ?? "")

    }

    checkSession()

  },[router])

  /* -----------------------------
  LOGOUT
  ----------------------------- */

  async function logout(){

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
    <div className="flex min-h-screen bg-gray-100 overflow-hidden">

      {/* MOBILE MENU BUTTON */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 bg-white px-3 py-2 rounded shadow"
      >
        ☰
      </button>

      {/* OVERLAY */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={`
          fixed lg:relative z-40
          w-60 bg-white border-r border-gray-200 h-full
          transform transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >

        <div className="p-6">
          <h1 className="text-xl font-semibold text-gray-900">
            PineTree
          </h1>
        </div>

        <nav className="px-3 space-y-1">

          {nav.map((item) => {

            const active = pathname === item.href

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm font-medium transition
                ${
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
      <div className="flex-1 flex flex-col w-full">

        {/* TOP BAR */}
        <header className="h-16 bg-blue-600 flex items-center justify-between px-4 lg:px-8 shadow-sm relative">

          {/* LEFT SPACER FOR MOBILE BUTTON */}
          <div className="lg:hidden w-10" />

          <div
            onClick={()=>setMenuOpen(!menuOpen)}
            className="text-sm font-medium text-white cursor-pointer hover:opacity-80"
          >
            Account
          </div>

          {menuOpen && (

            <div className="absolute right-4 lg:right-8 top-14 w-52 bg-white border border-gray-200 rounded-lg shadow-lg p-3">

              <div className="text-xs text-gray-500 mb-2">
                Signed in as
              </div>

              <div className="text-sm font-medium text-gray-900 mb-3 break-all">
                {userEmail}
              </div>

              <button
                onClick={logout}
                className="w-full text-left text-sm text-red-600 hover:bg-gray-100 rounded px-2 py-1"
              >
                Sign out
              </button>

            </div>

          )}

        </header>

        {/* PAGE CONTENT */}
        <main className="flex-1 p-4 lg:p-10 overflow-auto">

          <div className="max-w-6xl mx-auto w-full">
            {children}
          </div>

        </main>

        <Toaster position="top-right" richColors closeButton />
      </div>

    </div>
  )
}