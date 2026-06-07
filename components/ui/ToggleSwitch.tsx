"use client"

export default function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={`
        relative inline-flex h-7 w-12 items-center rounded-full transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100
        ${checked ? "bg-blue-600" : "bg-gray-300"}
        ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}
      `}
    >
      <span
        className={`
          inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition
          ${checked ? "translate-x-6" : "translate-x-1"}
        `}
      />
    </button>
  )
}
