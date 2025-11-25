package com.independent.cardcodex.feature_binder

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
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
fun DecksScreen(
    onDeckClick: (Long) -> Unit,
    viewModel: DecksViewModel = hiltViewModel()
) {
    val decks by viewModel.decks.collectAsState()
    var newDeckName by remember { mutableStateOf("") }

    Scaffold(
        topBar = { TopAppBar(title = { Text("My Decks") }) }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            // Create Deck Section
            TextField(
                value = newDeckName,
                onValueChange = { newDeckName = it },
                label = { Text("New Deck Name") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = { 
                    if (newDeckName.isNotBlank()) {
                        viewModel.createDeck(newDeckName)
                        newDeckName = ""
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Create Deck")
            }

            // Deck List
            LazyColumn {
                items(decks) { deck ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp)
                            .clickable { onDeckClick(deck.id) }
                    ) {
                        Text(
                            text = deck.name,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }
        }
    }
}
