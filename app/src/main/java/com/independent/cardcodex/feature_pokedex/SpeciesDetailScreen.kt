package com.independent.cardcodex.feature_pokedex

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.independent.cardcodex.core_database.CardWithQuantity

@Composable
fun SpeciesDetailScreen(
    speciesId: Int,
    onBackClick: () -> Unit,
    viewModel: SpeciesDetailViewModel = hiltViewModel()
) {
    val cards by viewModel.getCardsForSpecies(speciesId).collectAsState(initial = emptyList())

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Species Details") },
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

@Composable
fun SpeciesDetailCardItem(
    cardWithQuantity: CardWithQuantity,
    onQuantityChange: (Int) -> Unit
) {
    val card = cardWithQuantity.card
    val quantity = cardWithQuantity.quantity

    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AsyncImage(
                model = card.imageUrl,
                contentDescription = card.name,
                modifier = Modifier.size(100.dp),
                contentScale = ContentScale.Fit
            )
            Spacer(modifier = Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(text = card.name, style = MaterialTheme.typography.titleMedium)
                Text(text = "Set: ${card.set}", style = MaterialTheme.typography.bodyMedium)
                Text(text = "ID: ${card.cardId}", style = MaterialTheme.typography.bodySmall)
            }
            
            // Stepper
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(
                    onClick = { if (quantity > 0) onQuantityChange(quantity - 1) },
                    enabled = quantity > 0
                ) {
                    Text("-", style = MaterialTheme.typography.titleLarge)
                }
                Text(
                    text = quantity.toString(),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 8.dp)
                )
                IconButton(onClick = { onQuantityChange(quantity + 1) }) {
                    Icon(Icons.Filled.Add, contentDescription = "Increase")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TopAppBar(
    title: @Composable () -> Unit,
    navigationIcon: @Composable () -> Unit
) {
    CenterAlignedTopAppBar(
        title = title,
        navigationIcon = navigationIcon,
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
        )
    )
}
