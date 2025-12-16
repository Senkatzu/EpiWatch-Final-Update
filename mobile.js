(function () {
    function qs(id) {
        return document.getElementById(id);
    }

    function setActiveMobileTab(pageId) {
        const tabs = document.querySelectorAll('.mobile-tab');
        tabs.forEach(t => t.classList.remove('active'));
        const target = document.querySelector(`.mobile-tab[data-page="${pageId}"]`);
        if (target) target.classList.add('active');
    }

    function openDrawer() {
        const backdrop = qs('mobile-drawer-backdrop');
        const drawer = qs('mobile-drawer');
        if (backdrop) backdrop.classList.add('open');
        if (drawer) {
            drawer.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
        }
        setActiveMobileTab('profile');
    }

    function closeDrawer() {
        const backdrop = qs('mobile-drawer-backdrop');
        const drawer = qs('mobile-drawer');
        if (backdrop) backdrop.classList.remove('open');
        if (drawer) {
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
        }

        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id) setActiveMobileTab(activePage.id);
    }

    function toggleDrawer() {
        const drawer = qs('mobile-drawer');
        if (!drawer) return;
        if (drawer.classList.contains('open')) closeDrawer();
        else openDrawer();
    }

    function wire() {
        const mobileProfileBtn = qs('mobile-profile-btn');
        if (mobileProfileBtn) mobileProfileBtn.addEventListener('click', toggleDrawer);

        const drawerClose = qs('mobile-drawer-close');
        if (drawerClose) drawerClose.addEventListener('click', closeDrawer);

        const backdrop = qs('mobile-drawer-backdrop');
        if (backdrop) backdrop.addEventListener('click', closeDrawer);

        const tabs = document.querySelectorAll('.mobile-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const page = tab.getAttribute('data-page');
                if (!page) return;

                if (page === 'profile') {
                    toggleDrawer();
                    return;
                }

                closeDrawer();
                if (window.showPage) window.showPage(page);
                setActiveMobileTab(page);
            });
        });

        window.addEventListener('epiwatch:page', (e) => {
            const pageId = e?.detail?.pageId;
            if (!pageId) return;
            closeDrawer();
            setActiveMobileTab(pageId);
        });

        window.addEventListener('epiwatch:logout', () => {
            closeDrawer();
            setActiveMobileTab('dashboard');
        });

        const active = document.querySelector('.page.active');
        if (active && active.id) setActiveMobileTab(active.id);
    }

    document.addEventListener('DOMContentLoaded', wire);
})();
