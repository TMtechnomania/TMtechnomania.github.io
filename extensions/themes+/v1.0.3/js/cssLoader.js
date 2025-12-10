export function loadCSS(href, id) {
    return new Promise((resolve) => {
        try {
            const existing = document.getElementById(id);
            if (existing) {
                return resolve(existing);
            }
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = () => resolve(link);
            link.onerror = () => resolve(link);
            const t = setTimeout(() => resolve(link), 3000);
            const once = (el) => {
                clearTimeout(t);
                link.onload = null;
                link.onerror = null;
            };
            link.onload = () => { once(link); resolve(link); };
            link.onerror = () => { once(link); resolve(link); };
            document.head.appendChild(link);
        } catch (e) {
            // console.error('loadCSS error', e);
            resolve(null);
        }
    });
}

export function unloadCSS(id) {
    try {
        const el = document.getElementById(id);
        if (el) el.remove();
    } catch (e) {
        
    }
}
