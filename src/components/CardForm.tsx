import type { BusinessCard } from "../types";

export type FormFields = Pick<
  BusinessCard,
  "name" | "company" | "title" | "phone" | "fax" | "email" | "address" | "website" | "note"
>;

interface Field {
  key: keyof FormFields;
  label: string;
  placeholder?: string;
  type?: string;
}

const FIELDS: Field[] = [
  { key: "name", label: "氏名", placeholder: "山田 太郎" },
  { key: "company", label: "会社名", placeholder: "株式会社サンプル" },
  { key: "title", label: "役職", placeholder: "営業部長" },
  { key: "phone", label: "電話番号", placeholder: "03-1234-5678", type: "tel" },
  { key: "fax", label: "FAX", placeholder: "03-1234-5679", type: "tel" },
  { key: "email", label: "メールアドレス", placeholder: "taro@example.com", type: "email" },
  { key: "address", label: "住所", placeholder: "東京都千代田区…" },
  { key: "website", label: "Webサイト", placeholder: "https://example.com", type: "url" },
  { key: "note", label: "メモ", placeholder: "名刺交換時のメモなど" }
];

interface Props {
  value: FormFields;
  onChange: (patch: Partial<FormFields>) => void;
  disabled?: boolean;
}

export default function CardForm({ value, onChange, disabled }: Props) {
  return (
    <div className="card-form">
      {FIELDS.map((field) => (
        <label key={field.key} className="card-form-row">
          <span>{field.label}</span>
          {field.key === "note" || field.key === "address" ? (
            <textarea
              rows={2}
              disabled={disabled}
              value={value[field.key]}
              placeholder={field.placeholder}
              onChange={(e) => onChange({ [field.key]: e.target.value })}
            />
          ) : (
            <input
              type={field.type ?? "text"}
              disabled={disabled}
              value={value[field.key]}
              placeholder={field.placeholder}
              onChange={(e) => onChange({ [field.key]: e.target.value })}
            />
          )}
        </label>
      ))}
    </div>
  );
}
