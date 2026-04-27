import Image from "next/image";

type BrandLogoProps = {
  className?: string;
  priority?: boolean;
};

export function BrandLogo({ className, priority = false }: BrandLogoProps) {
  return (
    <span className={["brand-logo", className].filter(Boolean).join(" ")}>
      <Image
        src="/logo.png"
        alt="Odogwu HQ"
        width={1024}
        height={1024}
        className="brand-logo-image"
        priority={priority}
      />
      <span className="brand-logo-tag">Alpha</span>
    </span>
  );
}
