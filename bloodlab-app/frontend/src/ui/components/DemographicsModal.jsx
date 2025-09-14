import React, { useState, useEffect } from "react";

export default function DemographicsModal({ open, onClose, onSave, initial }) {
  const [sex, setSex] = useState(initial?.sex || "");
  const [race, setRace] = useState(initial?.race || "nonblack");
  const [age, setAge] = useState(initial?.age ?? "");

  useEffect(() => {
    if (open) {
      setSex(initial?.sex || "");
      setRace(initial?.race || "nonblack");
      setAge(initial?.age ?? "");
    }
  }, [open, initial]);

  const canSave = sex && String(age).trim() !== "" && Number(age) > 0;

  const submit = (e) => {
    e.preventDefault();
    if (!canSave) return;
    onSave({ sex, race, age: Number(age) });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* dialog */}
      <form
        onSubmit={submit}
        className="relative z-10 w-[92%] max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xl"
      >
        <h3 className="text-lg font-semibold mb-3">Your info</h3>

        <label className="block text-sm mb-2">
          Sex <span className="text-rose-500">*</span>
          <div className="mt-1 flex gap-3">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="sex"
                value="male"
                checked={sex === "male"}
                onChange={() => setSex("male")}
              />
              <span>Male</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="sex"
                value="female"
                checked={sex === "female"}
                onChange={() => setSex("female")}
              />
              <span>Female</span>
            </label>
          </div>
        </label>

        <label className="block text-sm mb-2">
          Age, years <span className="text-rose-500">*</span>
          <input
            type="number"
            min={1}
            max={120}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2"
            placeholder="25"
          />
        </label>

        <label className="block text-sm mb-3">
          Race
          <select
            value={race}
            onChange={(e) => setRace(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2"
          >
            <option value="nonblack">White</option>
            <option value="black">Black</option>
            <option value="other">Other types</option>
          </select>
          <div className="text-xs opacity-70 mt-1">
            To be updated later.
          </div>
        </label>

        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="px-3 py-2 text-sm rounded-md bg-rose-600 text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}