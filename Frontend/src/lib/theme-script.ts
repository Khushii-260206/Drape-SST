/** Runs in <head> before the page paints, so dark mode never flashes white. Keep it tiny and dependency-free. */
export const THEME_STORAGE_KEY = "drape:theme";

export const THEME_SCRIPT = `(function(){try{var m=localStorage.getItem("${THEME_STORAGE_KEY}");var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;
