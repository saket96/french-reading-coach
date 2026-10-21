// Small DOM helpers shared by the options page and the toolbar popup.

import { LANGS, languageName, uiLang } from "../background/settings.js";

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = chrome.i18n.getMessage(node.getAttribute("data-i18n")) || node.textContent;
  });
}

export function fillLangSelect(select, value, withAuto) {
  const codes = [...LANGS];
  [uiLang(), value].forEach((c) => {
    if (c && c !== "auto" && !codes.includes(c)) codes.push(c);
  });
  codes.sort((a, b) => languageName(a).localeCompare(languageName(b)));
  select.textContent = "";
  if (withAuto) select.appendChild(new Option("Auto (video language)", "auto"));
  codes.forEach((c) => select.appendChild(new Option(languageName(c), c)));
  select.value = value;
}
