import { NextRequest, NextResponse } from "next/server"

export async function GET(req:NextRequest){

const code = req.nextUrl.searchParams.get("code")

if(!code){
return NextResponse.redirect("/dashboard/providers")
}

const tokenRes = await fetch(
"https://api.coinbase.com/oauth/token",
{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
grant_type:"authorization_code",
code,
client_id:process.env.COINBASE_CLIENT_ID,
client_secret:process.env.COINBASE_CLIENT_SECRET,
redirect_uri:`${process.env.APP_URL}/api/oauth/coinbase/callback`
})
})

const tokenData = await tokenRes.json()

/*
store tokenData.access_token
in merchant_providers.credentials
*/

return NextResponse.redirect("/dashboard/providers?connected=coinbase")

}