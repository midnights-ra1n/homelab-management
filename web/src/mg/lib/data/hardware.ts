// Hardware stock: machines and components, with the machine each component is installed in.
import { get } from "../client";
import type { HardwareCategory, HardwareStatus } from "../constants";

export type HardwareItem = {
  id: number;
  name: string;
  /** ID homelab unique (HL-0001…), attribué au matériel seulement. */
  hl_id: string;
  category: HardwareCategory;
  status: HardwareStatus;
  brand: string;
  model: string;
  serial_number: string;
  specs: string;
  capacity_gb: number | null;
  /** Pièces identiques regroupées sur cette ligne. */
  quantity: number;
  parent_id: number | null;
  parent_name: string | null;
  asset_id: number | null;
  asset_name: string | null;
  location: string;
  vendor: string;
  purchase_date: string | null;
  purchase_price: number | null;
  warranty_until: string | null;
  notes: string;
  tags: string[];
  components: number;
  created_at: string;
  updated_at: string;
};

export const listHardware = () => get<HardwareItem[]>("/api/mg/hardware");
