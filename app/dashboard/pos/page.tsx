"use client"

import Link from "next/link"
import { useState, useEffect, useRef } from "react"
import { Eye, EyeOff } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"

type Terminal = {
  id: string
  name: string
  pin: string
  autolock: string
  merchant_id?: string
}

export default function POSPage() {

  const [terminals,setTerminals] = useState<Terminal[]>([])
  const [creating,setCreating] = useState(false)

  const [name,setName] = useState("")
  const [pin,setPin] = useState("")
  const [autoLock,setAutoLock] = useState("5")

  const [showPin,setShowPin] = useState(false)

  const [confirmDelete,setConfirmDelete] = useState(false)
  const [terminalToDelete,setTerminalToDelete] = useState<string | null>(null)

  const formRef = useRef<HTMLDivElement | null>(null)

  /* LOAD TERMINALS */

  useEffect(()=>{

    async function loadTerminals(){

      const { data:{ user } } = await supabase.auth.getUser()

      if(!user) return

      const { data,error } = await supabase
      .from("terminals")
      .select("*")
      .eq("merchant_id",user.id)

      if(error){
        toast.error("Failed to load terminals")
        return
      }

      if(data){
        setTerminals(data)
      }

    }

    loadTerminals()

  },[])

  /* SCROLL TO FORM */

  useEffect(()=>{
    if(creating && formRef.current){
      formRef.current.scrollIntoView({ behavior:"smooth" })
    }
  },[creating])

  /* CREATE TERMINAL */

  async function createTerminal(){

    if(!name){
      toast.error("Register name required")
      return
    }

    if(pin.length !== 4){
      toast.error("PIN must be 4 digits")
      return
    }

    const { data:{ user } } = await supabase.auth.getUser()

    if(!user) return

    const { data,error } = await supabase
      .from("terminals")
      .insert({
        merchant_id:user.id,
        name:name,
        pin:pin,
        autolock:autoLock
      })
      .select()
      .single()

    if(error){
      toast.error("Failed to create terminal")
      return
    }

    setTerminals(prev => [...prev,data])

    setName("")
    setPin("")
    setAutoLock("5")

    setCreating(false)

    toast.success("Terminal created")

  }

  /* DELETE TERMINAL */

  async function deleteTerminal(id:string){

    const { error } = await supabase
      .from("terminals")
      .delete()
      .eq("id",id)

    if(error){
      toast.error("Failed to delete terminal")
      return
    }

    setTerminals(prev => prev.filter(t=>t.id !== id))

    toast.success("Terminal deleted")

  }

  return (

    <div className="space-y-8 relative">

      {/* DELETE CONFIRM MODAL */}

      {confirmDelete && (

        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">

          <div className="bg-white rounded-xl p-6 w-96 shadow-lg">

            <h2 className="text-lg font-semibold mb-2">
              Delete Terminal
            </h2>

            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete this terminal?
            </p>

            <div className="flex justify-end gap-3">

              <button
                onClick={()=>setConfirmDelete(false)}
                className="px-4 py-2 text-sm border rounded-lg"
              >
                Cancel
              </button>

              <button
                onClick={()=>{
                  if(terminalToDelete){
                    deleteTerminal(terminalToDelete)
                  }
                  setConfirmDelete(false)
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg"
              >
                Delete Terminal
              </button>

            </div>

          </div>

        </div>

      )}

      {/* HEADER */}

      <div>

        <h1 className="text-2xl font-semibold text-gray-900">
          Point of Sale
        </h1>

        <p className="text-sm text-gray-500 mt-1">
          Manage POS terminals and launch checkout.
        </p>

      </div>

      {/* CREATE TERMINAL */}

      {creating && (

        <div ref={formRef} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

          <h2 className="text-lg font-semibold text-gray-900 mb-6">
            Create Terminal
          </h2>

          <div className="grid grid-cols-2 gap-6">

            <div>

              <label className="block text-sm text-gray-700 mb-2 font-medium">
                Register Name
              </label>

              <input
                value={name}
                onChange={(e)=>setName(e.target.value)}
                placeholder="Front Register"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
              />

            </div>

            <div>

              <label className="block text-sm text-gray-700 mb-2 font-medium">
                Terminal PIN
              </label>

              <div className="relative">

                <input
                  type={showPin ? "text" : "password"}
                  maxLength={4}
                  value={pin}
                  onChange={(e)=>setPin(e.target.value)}
                  placeholder="4 digit PIN"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-center tracking-widest text-black"
                />

                <button
                  type="button"
                  onClick={()=>setShowPin(!showPin)}
                  className="absolute right-3 top-2 text-gray-500"
                >
                  {showPin ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>

              </div>

            </div>

            <div>

              <label className="block text-sm text-gray-700 mb-2 font-medium">
                Auto Lock Timer
              </label>

              <select
                value={autoLock}
                onChange={(e)=>setAutoLock(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
              >
                <option value="1">1 minute</option>
                <option value="3">3 minutes</option>
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="never">Never</option>
              </select>

            </div>

          </div>

          <div className="flex gap-3 mt-6">

            <button
              onClick={createTerminal}
              className="bg-[#0052FF] text-white px-5 py-2 rounded-md text-sm"
            >
              Create Terminal
            </button>

            <button
              onClick={()=>setCreating(false)}
              className="bg-gray-200 text-gray-700 px-5 py-2 rounded-md text-sm"
            >
              Cancel
            </button>

          </div>

        </div>

      )}

      {/* TERMINAL LIST */}

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">

        <div className="flex justify-between items-center mb-6">

          <h2 className="text-lg font-semibold text-gray-900">
            Active Terminals
          </h2>

          <button
            onClick={()=>setCreating(true)}
            className="bg-[#0052FF] text-white px-4 py-2 rounded-md text-sm hover:opacity-90"
          >
            + New Terminal
          </button>

        </div>

        {terminals.length === 0 && (

          <div className="text-sm text-gray-500">
            No terminals created yet.
          </div>

        )}

        <div className="space-y-4">

          {terminals.map((t)=>(

            <div
              key={t.id}
              className="border border-gray-200 rounded-lg p-4 flex justify-between items-center"
            >

              <div>

                <div className="font-semibold text-gray-900">
                  {t.name}
                </div>

                <div className="text-sm text-gray-500">
                  {t.id}
                </div>

                <div className="text-sm text-green-600 mt-1">
                  ● Active
                </div>

              </div>

              <div className="flex gap-3">

                <Link
                  href={`/terminal?tid=${t.id}`}
                  className="px-3 py-1.5 bg-[#0052FF] text-white text-sm rounded-md hover:opacity-90"
                >
                  Launch
                </Link>

                <button
                  onClick={()=>{
                    setTerminalToDelete(t.id)
                    setConfirmDelete(true)
                  }}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300"
                >
                  Delete
                </button>

              </div>

            </div>

          ))}

        </div>

      </div>

    </div>

  )

}