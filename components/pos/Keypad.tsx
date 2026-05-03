"use client"

type Props = {
  digits: string
  setDigits: (value: string | ((prev: string) => string)) => void
  maxLength?: number
  showDecimal?: boolean
}

export default function Keypad({
  digits,
  setDigits,
  maxLength = 11,
  showDecimal = false,
}: Props) {
  void digits

  function press(num: string) {
    setDigits((prev: string) => {
      if (num === ".") {
        if (prev.includes(".")) return prev           // no double decimal
        if (prev.length >= maxLength) return prev
        return (prev || "0") + "."                   // "0." if nothing typed yet
      }
      if (prev.length >= maxLength) return prev
      // max 2 digits after decimal
      if (prev.includes(".")) {
        const decimals = prev.split(".")[1] ?? ""
        if (decimals.length >= 2) return prev
      }
      return prev + num
    })
  }

  function clear() {
    setDigits("")
  }

  function backspace() {
    setDigits((prev: string) => prev.slice(0, -1))
  }

  const btn =
    "h-14 rounded-xl border border-gray-200 bg-white text-gray-900 font-semibold text-base shadow transition-all duration-150 hover:border-blue-300 hover:bg-blue-50 hover:shadow-md active:translate-y-[1px] active:bg-blue-100 active:shadow-sm"

  return (
    <div className="grid grid-cols-3 gap-3 max-w-[340px] mx-auto">

      {[1,2,3,4,5,6,7,8,9].map((n) => (
        <button
          key={n}
          onClick={() => press(n.toString())}
          className={btn}
        >
          {n}
        </button>
      ))}

      {showDecimal ? (
        <button onClick={() => press(".")} className={btn}>
          .
        </button>
      ) : (
        <button onClick={clear} className={btn}>
          C
        </button>
      )}

      <button onClick={() => press("0")} className={btn}>
        0
      </button>

      <button onClick={backspace} className={btn}>
        ←
      </button>

    </div>
  )
}
