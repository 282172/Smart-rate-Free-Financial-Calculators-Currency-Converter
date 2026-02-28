document.addEventListener('DOMContentLoaded', function() {
    const kebabToggle = document.getElementById('kebabToggle');
    const dropdown = document.getElementById('kebabDropdown');

    if (kebabToggle && dropdown) {
        kebabToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdown.classList.toggle('show');
        });
        window.addEventListener('click', function() {
            dropdown.classList.remove('show');
        });
        dropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }

    // Update footer copyright year
    const footerYear = document.querySelector('.footer-content p');
    if (footerYear) {
        const currentYear = new Date().getFullYear();
        footerYear.innerHTML = footerYear.innerHTML.replace('2025', currentYear);
    }
});