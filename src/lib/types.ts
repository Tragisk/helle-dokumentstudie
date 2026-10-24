export type Rolle = "admin" | "rediger" | "laes";
export type Status = "kladde" | "til" | "godk";

export interface Bruger { email: string; bruger_id: string | null; navn: string; rolle: Rolle; aktiv: boolean; oprettet: string; }
export interface DokType { id: string; navn: string; sidefod_titel: string; label: string; css: string; sortering: number; arkiveret: boolean; }
export interface SkabelonVersion {
  id: string; dok_id: string; version: string | null; status: "kladde" | "publiceret"; sider: string[];
  note: string; forfatter_navn: string; oprettet: string; opdateret: string; publiceret: string | null; slettet: boolean;
}
export interface Partner {
  id: string; navn: string; logo: string | null; cvr: string; ft_id: string; kontakt: string; email: string; noter: string;
  onboarding: Record<string, string | null>; oprettet: string; arkiveret: boolean;
}
export interface PartnerDok {
  partner_id: string; dok_id: string; tilstand: "standard" | "variant"; skabelon_version: string | null;
  variant_version: string | null; status: Status; opdateret: string;
}
export interface VariantVersion {
  id: string; partner_id: string; dok_id: string; version: string | null; status: "kladde" | "publiceret"; baseret_paa: string;
  sider: string[]; note: string; forfatter_navn: string; oprettet: string; opdateret: string; publiceret: string | null; slettet: boolean;
}
export interface LogLinje { id: number; tid: string; bruger_navn: string; handling: string; partner_id: string | null; dok_id: string | null; detaljer: Record<string, unknown>; }

export interface Data {
  dokTyper: DokType[];
  skabeloner: SkabelonVersion[];
  partnere: Partner[];
  partnerDoks: PartnerDok[];
  varianter: VariantVersion[];
  brugere: Bruger[];
}

/** Et dokumentindhold, der kan vises: en skabelonversion, en variantversion eller en kladde. */
export interface Kilde {
  key: string;               // fx "s:1.2", "s:kladde", "v:1.0", "v:kladde"
  type: "skabelon" | "variant";
  version: string | null;    // null = kladde
  label: string;
  sider: string[];
  rec: SkabelonVersion | VariantVersion;
  baseretPaa?: string;
}

export const STATUS_TEKST: Record<Status, string> = { kladde: "Kladde", til: "Til godkendelse", godk: "Godkendt" };
export const ROLLE_TEKST: Record<Rolle, string> = { admin: "Admin", rediger: "Rediger", laes: "Læs og download" };
export const ONBOARDING: [string, string][] = [
  ["guide", "Partnerguide sendt"], ["produkt", "Produktark sendt"], ["dd_sendt", "Due diligence sendt"],
  ["dd_modt", "Due diligence modtaget"], ["forh", "Forhåndskontrakt sendt"], ["kontrakt", "Formel kontrakt underskrevet"],
  ["portal", "Adgang til Brokerportal oprettet"],
];
