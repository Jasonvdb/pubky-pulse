import Image from "next/image";

export function PulseLogo({ className, alt = "" }: { className?: string; alt?: string }) {
  return (
    <Image
      src="/pulse-logo.png"
      alt={alt}
      width={128}
      height={128}
      className={className}
    />
  );
}
