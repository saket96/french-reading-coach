// Fills the product name from _locales so renaming touches one file.
document.querySelectorAll("[data-i18n]").forEach((node) => {
  node.textContent = chrome.i18n.getMessage(node.getAttribute("data-i18n")) || node.textContent;
});
document.title = (chrome.i18n.getMessage("brand") || "") + " privacy policy";
