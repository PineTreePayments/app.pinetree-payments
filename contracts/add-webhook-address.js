const AUTH_TOKEN = "k2z2wm9zhp8tLizW6c-yO2QE37WwhcP0"
const WEBHOOK_ID = "wh_cgj3rsykmjnu24vf"
const ADDRESS_TO_ADD = "CXqPwfvDJ5HYBEwBC9id9oGH9hsf4gShywBN3WzDL5Aw"

async function main() {
  const res = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
    method: "PATCH",
    headers: {
      "X-Alchemy-Token": AUTH_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      webhook_id: WEBHOOK_ID,
      addresses_to_add: [ADDRESS_TO_ADD],
      addresses_to_remove: []
    })
  })

  const text = await res.text()
  console.log("Status:", res.status)
  console.log("Response:", text)

  if (res.ok) {
    console.log("\n✅ Address added to Base webhook successfully")
  } else {
    console.log("\n❌ Failed to add address")
  }
}

main().catch(console.error)
