package com.independent.cardcodex.feature_pokedex

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.independent.cardcodex.core_database.CardWithQuantity
import com.independent.cardcodex.data.Ability
import com.independent.cardcodex.data.Attack
import com.independent.cardcodex.data.Legalities
import com.independent.cardcodex.data.Weakness


// --- Helper Composables for displaying complex card details ---

@Composable
fun CardDetailsSection(title: String, content: @Composable () -> Unit) {
    if (title.isNotBlank()) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
        )
    }
    content()
}

@Composable
fun AbilityDisplay(ability: Ability) {
    Column(modifier = Modifier.fillMaxWidth().padding(start = 20.dp)) {
        Text(text = "${ability.name} (${ability.type})", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
        Text(text = ability.text, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun AbilitiesDisplay(abilities: List<Ability>?) {
    abilities?.takeIf { it.isNotEmpty() }?.let {
        CardDetailsSection(title = "Abilities") {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                it.forEach { ability -> AbilityDisplay(ability) }
            }
        }
    }
}

@Composable
fun AttackDisplay(attack: Attack) {
    Column(modifier = Modifier.fillMaxWidth().padding(start = 20.dp)) {
        Text(text = attack.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
        Text(text = "Cost: ${attack.cost.joinToString(", ")} (Total: ${attack.convertedEnergyCost})", style = MaterialTheme.typography.bodySmall)
        attack.damage?.let { Text(text = "Damage: $it", style = MaterialTheme.typography.bodySmall) }
        Text(text = attack.text, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun AttacksDisplay(attacks: List<Attack>?) {
    attacks?.takeIf { it.isNotEmpty() }?.let {
        CardDetailsSection(title = "Attacks") {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                it.forEach { attack -> AttackDisplay(attack) }
            }
        }
    }
}

@Composable
fun WeaknessDisplay(weakness: Weakness) {
    Text(text = "${weakness.type}: ${weakness.value}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp))
}

@Composable
fun WeaknessesDisplay(weaknesses: List<Weakness>?) {
    weaknesses?.takeIf { it.isNotEmpty() }?.let {
        CardDetailsSection(title = "Weaknesses") {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                it.forEach { weakness -> WeaknessDisplay(weakness) }
            }
        }
    }
}

@Composable
fun RetreatCostDisplay(retreatCost: List<String>?) {
    retreatCost?.takeIf { it.isNotEmpty() }?.let {
        CardDetailsSection(title = "Retreat Cost") {
            Text(text = it.joinToString(", "), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp))
        }
    }
}

@Composable
fun RulesDisplay(rules: List<String>?) {
    rules?.takeIf { it.isNotEmpty() }?.let {
        CardDetailsSection(title = "Rules") {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                it.forEach { rule -> Text(text = rule, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp)) }
            }
        }
    }
}

@Composable
fun LegalitiesDisplay(legalities: Legalities?) {
    legalities?.let {
        CardDetailsSection(title = "Legalities") {
            it.unlimited?.let { legal -> Text(text = "Unlimited: $legal", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp)) }
        }
    }
}

@Composable
fun SpeciesDetailScreen(
    speciesId: Int,
    onBackClick: () -> Unit,
    viewModel: SpeciesDetailViewModel = hiltViewModel()
) {
    val cards by viewModel.getCardsForSpecies(speciesId).collectAsState(initial = emptyList())

    Scaffold(
        topBar = {
            DetailTopAppBar(
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
    var expanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Top Section: Image + Basic Info
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top
            ) {
                AsyncImage(
                    model = card.imageUrl,
                    contentDescription = card.name,
                    modifier = Modifier.size(200.dp), // Increased Size
                    contentScale = ContentScale.Fit
                )
                Spacer(modifier = Modifier.width(16.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = card.name, style = MaterialTheme.typography.titleLarge)
                    card.supertype?.let { Text(text = it, style = MaterialTheme.typography.titleMedium) }
                    card.subtypes.takeIf { it.isNotEmpty() }?.let { Text(text = it.joinToString(", "), style = MaterialTheme.typography.bodyMedium) }
                    card.hp?.let { Text(text = "HP: $it", style = MaterialTheme.typography.bodyMedium) }
                    card.types.takeIf { it.isNotEmpty() }?.let { Text(text = "Types: ${it.joinToString(", ")}", style = MaterialTheme.typography.bodyMedium) }
                    card.set.let { Text(text = "Set: $it", style = MaterialTheme.typography.bodySmall) }
                    Text(text = "ID: ${card.cardId}", style = MaterialTheme.typography.bodySmall)
                }
            }

            // Quantity Stepper (Always Visible)
            Spacer(modifier = Modifier.height(16.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Quantity Owned:", style = MaterialTheme.typography.titleMedium)
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

            // Expand/Collapse Toggle
            IconButton(
                onClick = { expanded = !expanded },
                modifier = Modifier.align(Alignment.CenterHorizontally)
            ) {
                Icon(
                    imageVector = if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                    contentDescription = if (expanded) "Show Less" else "Show More"
                )
            }

            // Expandable Detailed Section
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column(modifier = Modifier.padding(horizontal = 8.dp)) { // Inset Content
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(8.dp))

                    AbilitiesDisplay(card.abilities)
                    AttacksDisplay(card.attacks)
                    RulesDisplay(card.rules)

                    if (card.supertype == "Pokémon") {
                        WeaknessesDisplay(card.weaknesses)
                        RetreatCostDisplay(card.retreatCost)
                    }

                    card.flavorText?.let {
                        CardDetailsSection(title = "Flavor Text") {
                            Text(text = it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp))
                        }
                    }

                    card.rarity?.let {
                        CardDetailsSection(title = "Rarity") {
                            Text(text = it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp))
                        }
                    }

                    card.artist?.let {
                        CardDetailsSection(title = "Artist") {
                            Text(text = it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp))
                        }
                    }

                    LegalitiesDisplay(card.legalities)
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailTopAppBar(
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