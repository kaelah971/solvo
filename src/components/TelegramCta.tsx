import { Cta } from "@/components/Cta";
import { telegram, telegramConfigured } from "@/lib/config";

type TelegramCtaProps = {
  label?: string;
  className?: string;
  variant?: "outline" | "text" | "light" | "dark";
  showConfigurationNote?: boolean;
};

/**
 * Primary Telegram action. Reads the central bot URL configuration constant.
 * Until the bot URL is configured, renders a disabled control with an honest
 * explanation — it never pretends to open a real bot.
 */
export function TelegramCta({
  label = "Open Solvo in Telegram",
  className = "",
  variant = "outline",
  showConfigurationNote = true,
}: TelegramCtaProps) {
  const variantClassName =
    variant === "text"
      ? "nav-interaction !border-transparent !px-0 !text-muted"
      : "";
  const ctaVariant = variant === "text" ? "outline" : variant;

  if (telegramConfigured) {
    return (
      <Cta
        href={telegram.botUrl}
        target="_blank"
        rel="noopener noreferrer"
        variant={ctaVariant}
        className={`${variantClassName} ${className}`}
      >
        {label}
      </Cta>
    );
  }

  if (!showConfigurationNote) {
    return (
      <Cta
        disabled
        title="Telegram bot URL is not configured"
        variant={ctaVariant}
        className={`${variantClassName} ${className}`}
      >
        {label}
      </Cta>
    );
  }

  return (
    <div className={className}>
      <Cta
        disabled
        title="Telegram bot URL is not configured"
        variant={ctaVariant}
        className={variantClassName}
      >
        {label}
      </Cta>
      <p className="mt-3 text-[11px] leading-[1.4] tracking-[0.08em] text-muted">
        Telegram access becomes available when the bot is configured.
      </p>
    </div>
  );
}
