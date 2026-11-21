// Shared office sign-in UI. Ozon, MoySklad and other owner-only services
// use the same secure HttpOnly session cookie created by /api/auth/google.
(() => {
  'use strict';
  const root = document.getElementById('officeAuth');
  const label = document.getElementById('officeAuthState');
  const login = document.getElementById('officeAuthLogin');
  const logout = document.getElementById('officeAuthLogout');
  const retry = document.getElementById('officeAuthRetry');
  if (![root, label, login, logout, retry].every(Boolean)) return;

  const allowed = new Set([
    'overview', 'departments', 'agents', 'workflow', 'studio',
    'production', 'connections', 'wbFinance', 'ozonFinance', 'ozonProfit'
  ]);
  const nextSection = () => {
    const section = location.hash.slice(1).split('/')[0];
    return allowed.has(section) ? section : 'overview';
  };
  const updateLoginLink = () => {
    login.href = '/api/auth/google/start?next=' + encodeURIComponent(nextSection());
  };
  const render = (message, mode) => {
    label.textContent = message;
    login.hidden = mode !== 'login';
    logout.hidden = mode !== 'owner';
    retry.hidden = mode !== 'retry';
    updateLoginLink();
  };
  let running = false;
  let lastAttempt = 0;
  const check = async () => {
    if (running) return;
    running = true;
    lastAttempt = Date.now();
    render('Проверяем вход…', 'checking');
    try {
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {Accept: 'application/json'},
        signal: AbortSignal.timeout(12000)
      });
      if (response.status === 200) {
        const body = await response.json();
        if (body?.authenticated === true && body.role === 'owner') {
          render('Вход владельца выполнен', 'owner');
        } else {
          render('Статус входа не подтверждён', 'retry');
        }
      } else if (response.status === 401) {
        render('Вход не выполнен', 'login');
      } else if (response.status === 403) {
        render('У выбранного Google-аккаунта нет доступа', 'login');
      } else {
        render('Сервис проверки входа недоступен', 'retry');
      }
    } catch {
      render('Не удалось проверить вход', 'retry');
    } finally {
      running = false;
    }
  };

  login.addEventListener('click', updateLoginLink);
  retry.addEventListener('click', () => {void check();});
  logout.addEventListener('click', async () => {
    if (running) return;
    running = true;
    logout.disabled = true;
    render('Выходим из офиса…', 'checking');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {Accept: 'application/json'},
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw Error('logout_unavailable');
      // Clear all loaded private section data, not just the topbar label.
      location.reload();
    } catch {
      render('Не удалось завершить сеанс', 'retry');
      logout.disabled = false;
    } finally {
      running = false;
    }
  });
  window.addEventListener('hashchange', updateLoginLink);
  window.addEventListener('pageshow', event => {
    if (event.persisted) void check();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' &&
        Date.now() - lastAttempt > 10 * 60 * 1000) void check();
  });
  updateLoginLink();
  void check();
})();
