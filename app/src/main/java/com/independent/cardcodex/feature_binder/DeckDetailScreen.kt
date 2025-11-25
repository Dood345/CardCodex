package com.independent.cardcodex.feature_binder

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckDetailScreen(
    deckId: Long,
    onBackClick: () -> Unit,
    viewModel: DeckDetailViewModel = hiltViewModel()
) {
    val deckWithCards by viewModel.deck.collectAsState()
    var importText by remember { mutableStateOf("") }

    LaunchedEffect(deckId) {
        viewModel.loadDeck(deckId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(deckWithCards?.deck?.name ?: "Deck Detail") }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            // Import Section
            TextField(
                value = importText,
                onValueChange = { importText = it },
                label = { Text("Paste Deck List Here") },
                modifier = Modifier.padding(bottom = 8.dp)
            )
            Button(onClick = { viewModel.importDeck(deckId, importText) }) {
                Text("Import")
            }

            // Card List
            LazyColumn {
                items(deckWithCards?.cards ?: emptyList()) { card ->
                    Text(text = card.name)
                }
            }
        }
    }
}
