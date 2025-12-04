package com.independent.cardcodex.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.independent.cardcodex.feature_binder.CollectionScreen
import com.independent.cardcodex.feature_binder.DecksScreen
import com.independent.cardcodex.feature_pokedex.PokedexScreen
import com.independent.cardcodex.feature_pokedex.CodexEntry

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    object Codex : Screen("codex", "Codex", Icons.Default.Home)
    object Collection : Screen("collection", "Collection", Icons.Default.Person)
    object Decks : Screen("decks", "Decks", Icons.AutoMirrored.Filled.List)
}

@Composable
fun MainScreen(
    onCodexEntryClick: (CodexEntry) -> Unit,
    onCollectionSpeciesClick: (Int) -> Unit,
    onDeckClick: (Long) -> Unit
) {
    val navController = rememberNavController()
    val items = listOf(Screen.Codex, Screen.Collection, Screen.Decks)

    Scaffold(
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination
                items.forEach { screen ->
                    NavigationBarItem(
                        icon = { Icon(screen.icon, contentDescription = null) },
                        label = { Text(screen.title) },
                        selected = currentDestination?.hierarchy?.any { it.route == screen.route } == true,
                        onClick = {
                            navController.navigate(screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Codex.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Screen.Codex.route) {
                PokedexScreen(onEntryClick = onCodexEntryClick)
            }
            composable(Screen.Collection.route) {
                CollectionScreen(onSpeciesClick = onCollectionSpeciesClick)
            }
            composable(Screen.Decks.route) {
                DecksScreen(onDeckClick = onDeckClick)
            }
        }
    }
}
