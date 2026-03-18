"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/database/supabase"
import { toast } from "sonner"

export default function SettingsPage() {

const [businessName,setBusinessName] = useState("")
const [email,setEmail] = useState("")

const [address,setAddress] = useState("")
const [city,setCity] = useState("")
const [state,setState] = useState("")
const [zip,setZip] = useState("")
const [country,setCountry] = useState("")
const [phone,setPhone] = useState("")
const [businessType,setBusinessType] = useState("")

const [closeHour,setCloseHour] = useState("12")
const [closeMinute,setCloseMinute] = useState("00")
const [closePeriod,setClosePeriod] = useState("AM")
const [reportToast,setReportToast] = useState(true)

const [taxEnabled,setTaxEnabled] = useState(false)
const [taxRate,setTaxRate] = useState("")
const [taxName,setTaxName] = useState("Sales Tax")

const [newEmail,setNewEmail] = useState("")
const [password,setPassword] = useState("")
const [confirmPassword,setConfirmPassword] = useState("")

const [loading,setLoading] = useState(true)
const [saving,setSaving] = useState(false)
const [updatingSecurity,setUpdatingSecurity] = useState(false)

useEffect(()=>{

async function loadSettings(){

setLoading(true)

const { data:{ user } } = await supabase.auth.getUser()

if(!user){
setLoading(false)
toast.error("User not authenticated")
return
}

setEmail(user.email ?? "")
setNewEmail(user.email ?? "")

let { data:settingsData } = await supabase
.from("merchant_settings")
.select("*")
.eq("merchant_id",user.id)
.maybeSingle()

if(!settingsData){

const { data } = await supabase
.from("merchant_settings")
.insert({ merchant_id:user.id })
.select()
.single()

settingsData = data

}

if(settingsData){

setBusinessName(settingsData.business_name ?? "")
setAddress(settingsData.address ?? "")
setCity(settingsData.city ?? "")
setState(settingsData.state ?? "")
setZip(settingsData.zip ?? "")
setCountry(settingsData.country ?? "")
setPhone(settingsData.phone ?? "")
setBusinessType(settingsData.business_type ?? "")
setReportToast(settingsData.report_toast ?? true)

const raw = settingsData.closeout_time ?? "12:00"
const parsed = parseCloseoutTime(raw)

setCloseHour(parsed.hour)
setCloseMinute(parsed.minute)
setClosePeriod(parsed.period)

}

let { data:taxData } = await supabase
.from("merchant_tax_settings")
.select("*")
.eq("merchant_id",user.id)
.maybeSingle()

if(!taxData){

const { data } = await supabase
.from("merchant_tax_settings")
.insert({
merchant_id:user.id,
tax_enabled:false,
tax_rate:0,
tax_name:"Sales Tax"
})
.select()
.single()

taxData = data

}

if(taxData){

setTaxEnabled(taxData.tax_enabled ?? false)
setTaxRate(
taxData.tax_rate !== null && taxData.tax_rate !== undefined
? String(taxData.tax_rate)
: ""
)

setTaxName(taxData.tax_name ?? "Sales Tax")

}

setLoading(false)

}

loadSettings()

},[])

function parseCloseoutTime(value:string){

const normalized = value.trim()

if(normalized.includes("AM") || normalized.includes("PM")){

const [time,period] = normalized.split(" ")
const [hour,minute] = time.split(":")

let hourNum = Number(hour)

if(period === "AM" && hourNum === 12){
hourNum = 0
}
else if(period === "PM" && hourNum !== 12){
hourNum += 12
}

return{
hour:String(hourNum).padStart(2,"0"),
minute:minute?.padStart(2,"0") || "00",
period:period === "PM" ? "PM" : "AM"
}

}

const [hour24,minute="00"] = normalized.split(":")
const hourNum = Number(hour24)

return{
hour:String(hourNum).padStart(2,"0"),
minute:minute.padStart(2,"0"),
period:hourNum >= 12 ? "PM" : "AM"
}

}

async function saveSettings(){

setSaving(true)

const { data:{ user } } = await supabase.auth.getUser()

if(!user){
setSaving(false)
toast.error("User not authenticated")
return
}

const closeoutTime = `${closeHour}:${closeMinute}`

const { error:settingsError } = await supabase
.from("merchant_settings")
.upsert({

merchant_id:user.id,
business_name:businessName || null,
address:address || null,
city:city || null,
state:state || null,
zip:zip || null,
country:country || null,
phone:phone || null,
business_type:businessType || null,
closeout_time:closeoutTime,
report_toast:reportToast

},{
onConflict:"merchant_id"
})

if(settingsError){
console.error(settingsError)
setSaving(false)
toast.error("Failed to save settings")
return
}

const { error:taxError } = await supabase
.from("merchant_tax_settings")
.upsert({

merchant_id:user.id,
tax_enabled:taxEnabled,
tax_rate:taxRate === "" ? 0 : Number(taxRate),
tax_name:taxName

},{
onConflict:"merchant_id"
})

if(taxError){
console.error(taxError)
setSaving(false)
toast.error("Failed to save tax settings")
return
}

setSaving(false)
toast.success("Settings saved")

}

async function updateSecurity(){

if(password && password !== confirmPassword){
toast.error("Passwords do not match")
return
}

if(!newEmail.trim() && !password.trim()){
toast.error("No security changes to update")
return
}

setUpdatingSecurity(true)

const updates:any = {}

if(newEmail && newEmail !== email){
updates.email = newEmail
}

if(password){
updates.password = password
}

const { error } = await supabase.auth.updateUser(updates)

if(error){
console.error(error)
setUpdatingSecurity(false)
toast.error(error.message)
return
}

setPassword("")
setConfirmPassword("")
setUpdatingSecurity(false)
toast.success("Security updated")

}

if(loading){

return(
<div className="space-y-10">
<h1 className="text-2xl font-semibold text-gray-900">
Settings
</h1>

<div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm text-gray-700">
Loading settings...
</div>

</div>
)

}

return(

<div className="space-y-10">

<h1 className="text-2xl font-semibold text-gray-900">
Settings
</h1>

{/* ACCOUNT */}

<div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">

<h2 className="text-lg font-semibold text-gray-900 mb-6">
Account
</h2>

<div className="grid grid-cols-2 gap-6">

<div>
<label className="text-sm text-gray-700">
Business Name
</label>

<input
value={businessName}
onChange={(e)=>setBusinessName(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
/>
</div>

<div>
<label className="text-sm text-gray-700">
Account Email
</label>

<input
value={email}
disabled
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-900"
/>
</div>

<div>
<label className="text-sm text-gray-700">
Business Address
</label>

<input
value={address}
onChange={(e)=>setAddress(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
/>
</div>

<div>
<label className="text-sm text-gray-700">
City
</label>

<input
value={city}
onChange={(e)=>setCity(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
/>
</div>

<div>
<label className="text-sm text-gray-700">
State
</label>

<input
value={state}
onChange={(e)=>setState(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
/>
</div>

<div>
<label className="text-sm text-gray-700">
ZIP
</label>

<input
value={zip}
onChange={(e)=>setZip(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
/>
</div>

<div>
<label className="text-sm text-gray-700">
Country
</label>

<input
value={country}
onChange={(e)=>setCountry(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
/>
</div>

<div>
<label className="text-sm text-gray-700">
Business Phone
</label>

<input
value={phone}
onChange={(e)=>setPhone(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
/>
</div>

<div>
<label className="text-sm text-gray-700">
Business Type
</label>

<select
value={businessType}
onChange={(e)=>setBusinessType(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
>

<option value="">
Select
</option>

<option value="retail">
Retail
</option>

<option value="restaurant">
Restaurant
</option>

<option value="services">
Services
</option>

<option value="online">
Online
</option>

</select>

</div>

</div>

</div>

{/* TAX */}

<div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">

<h2 className="text-lg font-semibold text-gray-900 mb-6">
Tax Configuration
</h2>

<div className="grid grid-cols-2 gap-6">

<div className="flex items-center gap-3">

<input
type="checkbox"
checked={taxEnabled}
onChange={(e)=>setTaxEnabled(e.target.checked)}
/>

<span className="text-sm text-gray-900">
Enable Tax Collection
</span>

</div>

<div>

<label className="text-sm text-gray-700">
Tax Name
</label>

<input
value={taxName}
onChange={(e)=>setTaxName(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
/>

</div>

<div>

<label className="text-sm text-gray-700">
Tax Rate (%)
</label>

<input
value={taxRate}
onChange={(e)=>setTaxRate(e.target.value)}
className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
placeholder="8.25"
/>

</div>

</div>

</div>

{/* REPORTING */}

<div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">

<h2 className="text-lg font-semibold text-gray-900 mb-6">
Reporting
</h2>

<div className="grid grid-cols-2 gap-6">

<div>

<label className="text-sm text-gray-700">
Business Day Closeout Time
</label>

<div className="mt-2 flex items-center gap-3">

<select
value={closeHour}
onChange={(e)=>setCloseHour(e.target.value)}
className="border border-gray-300 rounded-md px-3 py-2 text-gray-900 bg-white w-24"
>

{Array.from({length:24},(_,i)=>{

const val = i < 10 ? `0${i}` : `${i}`

return(
<option key={val} value={val}>
{val}
</option>
)

})}

</select>

<span className="text-gray-900 font-medium">
:
</span>

<select
value={closeMinute}
onChange={(e)=>setCloseMinute(e.target.value)}
className="border border-gray-300 rounded-md px-3 py-2 text-gray-900 bg-white w-24"
>

{["00","05","10","15","20","25","30","35","40","45","50","55"].map(val=>(
<option key={val} value={val}>
{val}
</option>
))}

</select>

</div>

<p className="text-xs text-gray-500 mt-2">
Determines when daily reports and revenue totals reset.
</p>

</div>

<div>

<label className="text-sm text-gray-700">
End-of-Day Reminder
</label>

<div className="mt-2 flex items-center gap-3">

<input
type="checkbox"
checked={reportToast}
onChange={(e)=>setReportToast(e.target.checked)}
/>

<span className="text-sm text-gray-900">
Show reminder toast to print daily report
</span>

</div>

</div>

</div>

</div>

{/* SAVE */}

<div>

<button
onClick={saveSettings}
disabled={saving}
className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-60"
>

{saving ? "Saving..." : "Save Settings"}

</button>

</div>

</div>

)

}