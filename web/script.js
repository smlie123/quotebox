document.addEventListener('DOMContentLoaded', () => {
    // Navbar scroll effect
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 10) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Mobile Menu Toggle (Simple implementation)
    const mobileBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');
    
    if (mobileBtn) {
        mobileBtn.addEventListener('click', () => {
            // For a production site, we'd toggle a class on a mobile menu container
            // Since we hid nav-links in CSS for mobile, let's just alert for now or implement a simple toggle if needed
            // But for this static page request, I'll keep it simple.
            // A more robust implementation would require adding a mobile menu container in HTML.
            console.log('Mobile menu clicked');
        });
    }

    // Smooth Scroll for Anchor Links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80, // Offset for fixed header
                    behavior: 'smooth'
                });
            }
        });
    });

    // Simple animation for the hero mockup
    const menuItems = document.querySelectorAll('.menu-item');
    if (menuItems.length > 0) {
        // Highlight "Save to QuoteBox" periodically to draw attention
        setInterval(() => {
            const saveItem = menuItems[1]; // The "Save to QuoteBox" item
            saveItem.classList.add('highlight');
            setTimeout(() => {
                saveItem.classList.remove('highlight');
            }, 2000);
        }, 5000);
    }
});
