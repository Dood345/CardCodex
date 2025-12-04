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
import com.independent.cardcodex.feature_binder.DeckBuilderScreen
import com.independent.cardcodex.feature_pokedex.SpeciesDetailScreen
import com.independent.cardcodex.feature_pokedex.CardGroupDetailScreen
import com.independent.cardcodex.ui.MainScreen
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
                    
                    NavHost(navController = navController, startDestination = "home") {
                        composable("home") {
                            MainScreen(
                                onCodexEntryClick = { entry ->
                                    if (entry.isSpecies && entry.speciesId != null) {
                                        navController.navigate("species_detail/${entry.speciesId}")
                                    } else {
                                        navController.navigate("card_group_detail/${entry.name}")
                                    }
                                },
                                onCollectionSpeciesClick = { speciesId ->
                                    navController.navigate("species_detail/$speciesId")
                                },
                                onDeckClick = { deckId ->
                                    navController.navigate("deck_detail/$deckId")
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

                        composable(
                            route = "card_group_detail/{cardName}",
                            arguments = listOf(navArgument("cardName") { type = NavType.StringType })
                        ) { backStackEntry ->
                            val cardName = backStackEntry.arguments?.getString("cardName") ?: return@composable
                            CardGroupDetailScreen(
                                cardName = cardName,
                                onBackClick = { navController.popBackStack() }
                            )
                        }

                        composable(
                            route = "deck_detail/{deckId}",
                            arguments = listOf(navArgument("deckId") { type = NavType.LongType })
                        ) { backStackEntry ->
                            val deckId = backStackEntry.arguments?.getLong("deckId") ?: return@composable
                            DeckBuilderScreen(
                                deckId = deckId,
                                onBackClick = { navController.popBackStack() }
                            )
                        }
                    }
                }
            }
        }
    }
}