package com.independent.cardcodex.feature_pokedex

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.MaterialTheme

@Composable
fun CardGroupDetailScreen(
    cardName: String,
    onBackClick: () -> Unit,
    viewModel: SpeciesDetailViewModel = hiltViewModel()
) {
    val cards by viewModel.getCardsByName(cardName).collectAsState(initial = emptyList())

    Scaffold(
        topBar = {
            DetailTopAppBar(
                title = { Text(cardName) },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            items(cards) { cardWithQuantity ->
                SpeciesDetailCardItem(
                    cardWithQuantity = cardWithQuantity,
                    onQuantityChange = { newQty ->
                        viewModel.updateQuantity(cardWithQuantity.card.cardId, newQty)
                    }
                )
            }
        }
    }
}
