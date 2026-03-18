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
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition
        ${checked ? "bg-blue-600" : "bg-gray-300"}
        cursor-${disabled ? "not-allowed" : "pointer"}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white transition
          ${checked ? "translate-x-6" : "translate-x-1"}
        `}
      />
    </button>
  )
}