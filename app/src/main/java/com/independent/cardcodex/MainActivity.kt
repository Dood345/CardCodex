package com.independent.cardcodex

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.independent.cardcodex.feature_pokedex.PokedexScreen
import com.independent.cardcodex.feature_pokedex.SpeciesDetailScreen
import com.independent.cardcodex.ui.theme.CardCodexTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CardCodexTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val navController = rememberNavController()
                    
                    NavHost(navController = navController, startDestination = "pokedex") {
                        composable("pokedex") {
                            PokedexScreen(
                                onSpeciesClick = { speciesId ->
                                    navController.navigate("species_detail/$speciesId")
                                }
                            )
                        }
                        
                        composable(
                            route = "species_detail/{speciesId}",
                            arguments = listOf(navArgument("speciesId") { type = NavType.IntType })
                        ) { backStackEntry ->
                            val speciesId = backStackEntry.arguments?.getInt("speciesId") ?: return@composable
                            SpeciesDetailScreen(
                                speciesId = speciesId,
                                onBackClick = { navController.popBackStack() }
                            )
                        }
                    }
                }
            }
        }
    }
}