"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FormSelect({
  name,
  options,
  defaultValue,
  id,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  id?: string;
}) {
  return (
    <Select name={name} defaultValue={defaultValue ?? options[0]?.value} items={options}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
