import { computed, ref, shallowRef } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { defineStore } from 'pinia';
import { useBoolean } from '@sa/hooks';
import type { CustomRoute, ElegantConstRoute, LastLevelRouteKey, RouteKey, RouteMap } from '@elegant-router/types';
import { SetupStoreId } from '@/enum';
import { router } from '@/router';
import { createStaticRoutes, getAuthVueRoutes } from '@/router/routes';
import { ROOT_ROUTE } from '@/router/routes/builtin';
import { getRouteName, getRoutePath } from '@/router/elegant/transform';
import { fetchGetUserRoutes, fetchIsRouteExist } from '@/service/api';
import { useAppStore } from '../app';
import { useAuthStore } from '../auth';
import { useTabStore } from '../tab';
import {
  filterAuthRoutesByRoles,
  getBreadcrumbsByRoute,
  getCacheRouteNames,
  getGlobalMenusByAuthRoutes,
  getSelectedMenuKeyPathByKey,
  isRouteExistByRouteName,
  sortRoutesByOrder,
  transformMenuToSearchMenus,
  updateLocaleOfGlobalMenus
} from './shared';

export const useRouteStore = defineStore(SetupStoreId.Route, () => {
  const appStore = useAppStore();
  const authStore = useAuthStore();
  const tabStore = useTabStore();
  const { bool: isInitConstantRoute, setBool: setIsInitConstantRoute } = useBoolean();
  const { bool: isInitAuthRoute, setBool: setIsInitAuthRoute } = useBoolean();

  /**
   * Auth route mode
   *
   * It recommends to use static mode in the development environment, and use dynamic mode in the production
   * environment, if use static mode in development environment, the auth routes will be auto generated by plugin
   * "@elegant-router/vue"
   */
  const authRouteMode = ref(import.meta.env.VITE_AUTH_ROUTE_MODE);

  /** Home route key */
  const routeHome = ref(import.meta.env.VITE_ROUTE_HOME);

  /**
   * Set route home
   *
   * @param routeKey Route key
   */
  function setRouteHome(routeKey: LastLevelRouteKey) {
    routeHome.value = routeKey;
  }

  /** constant routes */
  const constantRoutes = shallowRef<ElegantConstRoute[]>([]);

  function addConstantRoutes(routes: ElegantConstRoute[]) {
    const constantRoutesMap = new Map<string, ElegantConstRoute>([]);

    routes.forEach(route => {
      constantRoutesMap.set(route.name, route);
    });

    constantRoutes.value = Array.from(constantRoutesMap.values());
  }

  /** auth routes */
  const authRoutes = shallowRef<ElegantConstRoute[]>([]);

  function addAuthRoutes(routes: ElegantConstRoute[]) {
    const authRoutesMap = new Map<string, ElegantConstRoute>([]);

    routes.forEach(route => {
      authRoutesMap.set(route.name, route);
    });

    authRoutes.value = Array.from(authRoutesMap.values());
  }

  const removeRouteFns: (() => void)[] = [];

  /** Global menus */
  const menus = ref<App.Global.Menu[]>([]);
  const searchMenus = computed(() => transformMenuToSearchMenus(menus.value));

  /** Get global menus */
  function getGlobalMenus(routes: ElegantConstRoute[]) {
    menus.value = getGlobalMenusByAuthRoutes(routes);
  }

  /** Update global menus by locale */
  function updateGlobalMenusByLocale() {
    menus.value = updateLocaleOfGlobalMenus(menus.value);
  }

  /** Cache routes */
  const cacheRoutes = ref<RouteKey[]>([]);

  /** All cache routes */
  const allCacheRoutes = shallowRef<RouteKey[]>([]);

  /**
   * Get cache routes
   *
   * @param routes Vue routes
   */
  function getCacheRoutes(routes: RouteRecordRaw[]) {
    const alls = getCacheRouteNames(routes);

    cacheRoutes.value = alls;
    allCacheRoutes.value = [...alls];
  }

  /**
   * Add cache routes
   *
   * @param routeKey
   */
  function addCacheRoutes(routeKey: RouteKey) {
    if (cacheRoutes.value.includes(routeKey)) return;

    cacheRoutes.value.push(routeKey);
  }

  /**
   * Remove cache routes
   *
   * @param routeKey
   */
  function removeCacheRoutes(routeKey: RouteKey) {
    const index = cacheRoutes.value.findIndex(item => item === routeKey);

    if (index === -1) return;

    cacheRoutes.value.splice(index, 1);
  }

  /**
   * Is cached route
   *
   * @param routeKey
   */
  function isCachedRoute(routeKey: RouteKey) {
    return allCacheRoutes.value.includes(routeKey);
  }

  /**
   * Re cache routes by route key
   *
   * @param routeKey
   */
  async function reCacheRoutesByKey(routeKey: RouteKey) {
    if (!isCachedRoute(routeKey)) return;

    removeCacheRoutes(routeKey);

    await appStore.reloadPage();

    addCacheRoutes(routeKey);
  }

  /**
   * Re cache routes by route keys
   *
   * @param routeKeys
   */
  async function reCacheRoutesByKeys(routeKeys: RouteKey[]) {
    for await (const key of routeKeys) {
      await reCacheRoutesByKey(key);
    }
  }

  /** Global breadcrumbs */
  const breadcrumbs = computed(() => getBreadcrumbsByRoute(router.currentRoute.value, menus.value));

  /** Reset store */
  async function resetStore() {
    const routeStore = useRouteStore();

    routeStore.$reset();

    resetVueRoutes();

    // after reset store, need to re-init constant route
    await initConstantRoute();
  }

  /** Reset vue routes */
  function resetVueRoutes() {
    removeRouteFns.forEach(fn => fn());
    removeRouteFns.length = 0;
  }

  /** init constant route */
  async function initConstantRoute() {
    if (isInitConstantRoute.value) return;

    const staticRoute = createStaticRoutes();
    // 常量路由不走后端
    addConstantRoutes(staticRoute.constantRoutes);
    // if (authRouteMode.value === 'static') {
    //   addConstantRoutes(staticRoute.constantRoutes);
    // } else {
    //   const { data, error } = await fetchGetConstantRoutes();
    //
    //   if (!error) {
    //     addConstantRoutes(data);
    //   } else {
    //     // if fetch constant routes failed, use static constant routes
    //     addConstantRoutes(staticRoute.constantRoutes);
    //   }
    // }

    handleConstantAndAuthRoutes();

    setIsInitConstantRoute(true);
  }

  /** Init auth route */
  async function initAuthRoute() {
    if (authRouteMode.value === 'static') {
      initStaticAuthRoute();
    } else {
      await initDynamicAuthRoute();
    }

    tabStore.initHomeTab();
  }

  /** Init static auth route */
  function initStaticAuthRoute() {
    const { authRoutes: staticAuthRoutes } = createStaticRoutes();

    if (authStore.isStaticSuper) {
      addAuthRoutes(staticAuthRoutes);
    } else {
      const filteredAuthRoutes = filterAuthRoutesByRoles(staticAuthRoutes, []);

      addAuthRoutes(filteredAuthRoutes);
    }

    handleConstantAndAuthRoutes();

    setIsInitAuthRoute(true);
  }

  /** Init dynamic auth route */
  async function initDynamicAuthRoute() {
    const { data, error } = await fetchGetUserRoutes();

    if (!error) {
      const { routes, home } = data;

      addAuthRoutes(routes);

      handleConstantAndAuthRoutes();

      setRouteHome(home);

      handleUpdateRootRouteRedirect(home);

      setIsInitAuthRoute(true);
    } else {
      // if fetch user routes failed, reset store
      authStore.resetStore();
    }
  }

  /** handle constant and auth routes */
  function handleConstantAndAuthRoutes() {
    const allRoutes = [...constantRoutes.value, ...authRoutes.value];

    const sortRoutes = sortRoutesByOrder(allRoutes);

    const vueRoutes = getAuthVueRoutes(sortRoutes);

    resetVueRoutes();

    addRoutesToVueRouter(vueRoutes);

    getGlobalMenus(sortRoutes);

    getCacheRoutes(vueRoutes);
  }

  /**
   * Add routes to vue router
   *
   * @param routes Vue routes
   */
  function addRoutesToVueRouter(routes: RouteRecordRaw[]) {
    routes.forEach(route => {
      const removeFn = router.addRoute(route);
      addRemoveRouteFn(removeFn);
    });
  }

  /**
   * Add remove route fn
   *
   * @param fn
   */
  function addRemoveRouteFn(fn: () => void) {
    removeRouteFns.push(fn);
  }

  /**
   * Update root route redirect when auth route mode is dynamic
   *
   * @param redirectKey Redirect route key
   */
  function handleUpdateRootRouteRedirect(redirectKey: LastLevelRouteKey) {
    const redirect = getRoutePath(redirectKey);

    if (redirect) {
      const rootRoute: CustomRoute = { ...ROOT_ROUTE, redirect };

      router.removeRoute(rootRoute.name);

      const [rootVueRoute] = getAuthVueRoutes([rootRoute]);

      router.addRoute(rootVueRoute);
    }
  }

  /**
   * Get is auth route exist
   *
   * @param routePath Route path
   */
  async function getIsAuthRouteExist(routePath: RouteMap[RouteKey]) {
    const routeName = getRouteName(routePath);

    if (!routeName) {
      return false;
    }

    if (authRouteMode.value === 'static') {
      const { authRoutes: staticAuthRoutes } = createStaticRoutes();
      return isRouteExistByRouteName(routeName, staticAuthRoutes);
    }

    const { data } = await fetchIsRouteExist(routeName);

    return data;
  }

  /**
   * Get selected menu key path
   *
   * @param selectedKey Selected menu key
   */
  function getSelectedMenuKeyPath(selectedKey: string) {
    return getSelectedMenuKeyPathByKey(selectedKey, menus.value);
  }

  return {
    resetStore,
    routeHome,
    menus,
    searchMenus,
    updateGlobalMenusByLocale,
    cacheRoutes,
    reCacheRoutesByKey,
    reCacheRoutesByKeys,
    breadcrumbs,
    initConstantRoute,
    isInitConstantRoute,
    initAuthRoute,
    isInitAuthRoute,
    setIsInitAuthRoute,
    getIsAuthRouteExist,
    getSelectedMenuKeyPath
  };
});
