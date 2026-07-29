import Image from "next/image"

type Props = {
  src: string
  alt: string
  size?: number
  className?: string
  imageClassName?: string
  onClick?: () => void
}

export default function PaymentQrCode({
  src,
  alt,
  size = 216,
  className = "",
  imageClassName = "",
  onClick,
}: Props) {
  return (
    <div
      className={`flex w-fit rounded-xl bg-white p-2 ${onClick ? "cursor-pointer" : ""} ${className}`}
      onClick={onClick}
      data-payment-qr-code-backing="true"
    >
      <Image
        src={src}
        width={size}
        height={size}
        alt={alt}
        unoptimized
        className={`h-auto w-full rounded-lg ${imageClassName}`}
      />
    </div>
  )
}
