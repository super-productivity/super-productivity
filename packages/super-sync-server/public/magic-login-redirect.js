// Magic link login redirect script
// Reads token from data attribute, stores in sessionStorage, and redirects to main page
(function () {
  const token = document.body.dataset.token;
  if (token) {
    sessionStorage.setItem('loginToken', token);
    window.location.href = '/';
  }
})();
